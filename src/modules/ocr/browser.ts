import type { ImageAsset, Observation, OcrCapture } from '../../lib/contracts';

export type Crop = { x: number; y: number; width: number; height: number };

export type BrowserOcrOptions = {
  rotation: number;
  contrast: boolean;
  invert?: boolean;
  crop?: Crop;
  cropTarget?: string;
  /** Host-owned package signals (such as barcodes) run without importing them here. */
  beforeImage?: (asset: ImageAsset) => Promise<void>;
};

export type BrowserOcrResult = {
  text: string;
  observations: Observation[];
  confidence: number;
  captures: OcrCapture[];
};

type TextRecognition = { data: { text: string } };

/** Retry empty AUTO output once with table-friendly single-block segmentation. */
export async function retryShortAutoRecognition<T extends TextRecognition>(
  primary: T,
  retrySingleBlock: () => Promise<T>
): Promise<{ result: T; segmentationMode: 'auto' | 'single-block' }> {
  if (primary.data.text.trim().length >= 8) return { result: primary, segmentationMode: 'auto' };
  const fallback = await retrySingleBlock();
  return fallback.data.text.trim().length > primary.data.text.trim().length
    ? { result: fallback, segmentationMode: 'single-block' }
    : { result: primary, segmentationMode: 'auto' };
}

export const BROWSER_OCR_ENGINE_VERSION = '7.0.0';

export async function prepareImage(asset: ImageAsset, rotation = 0, contrast = false, crop?: Crop, invert = false): Promise<Blob> {
  const started = performance.now();
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(asset.blob);
    const box = crop
      ? { x: bitmap.width * crop.x / 100, y: bitmap.height * crop.y / 100, w: bitmap.width * crop.width / 100, h: bitmap.height * crop.height / 100 }
      : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    const scale = Math.min(3, 3000 / Math.max(box.w, box.h));
    const width = Math.round(box.w * scale);
    const height = Math.round(box.h * scale);
    const canvas = document.createElement('canvas');
    const swap = rotation % 180 !== 0;
    canvas.width = swap ? height : width;
    canvas.height = swap ? width : height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image. Try another photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.filter = [contrast ? 'grayscale(1) contrast(1.5)' : '', invert ? 'invert(1)' : ''].filter(Boolean).join(' ') || 'none';
    context.drawImage(bitmap, box.x, box.y, box.w, box.h, -width / 2, -height / 2, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Image preparation failed.')),
      'image/jpeg',
      0.98
    ));
  } finally {
    bitmap?.close();
    try {
      const name = 'nutriscan:image-preparation';
      if (performance.getEntriesByName(name, 'measure').length >= 100) performance.clearMeasures(name);
      performance.measure(name, { start: started, end: performance.now() });
    } catch { /* Local timing must never change OCR behavior. */ }
  }
}

/**
 * Runs local text recognition while leaving history, consent and barcode policy
 * in the application facade. Original OCR remains an observation, not a fact.
 */
export async function readOcrImages(
  assets: ImageAsset[],
  onProgress: (label: string, progress: number) => void,
  signal: AbortSignal,
  options: BrowserOcrOptions
): Promise<BrowserOcrResult> {
  const { createWorker, PSM } = await import('tesseract.js');
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let cancelled = false;
  let rejectAbort: ((reason: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    cancelled = true;
    void worker?.terminate();
    rejectAbort?.(new Error('Reading stopped. Your photos are still here.'));
  };
  signal.addEventListener('abort', abort);
  const timeout = setTimeout(abort, 120000);
  try {
    onProgress('Preparing the on-device reader', 0.02);
    worker = await Promise.race([createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr/',
      workerBlobURL: false,
      logger: message => { if (!cancelled) onProgress(message.status, Math.max(0.02, message.progress || 0)); }
    }).then(created => {
      if (cancelled) void created.terminate();
      return created;
    }), abortPromise]);
    if (cancelled) throw new Error('Reading stopped. Your photos are still here.');
    if (!worker) throw new Error('The on-device reader could not start.');
    const reader = worker;
    await reader.setParameters({ preserve_interword_spaces: '1' });
    const texts: string[] = [];
    const observations: Observation[] = [];
    const captures: OcrCapture[] = [];
    let confidence = 0;
    for (let index = 0; index < assets.length; index++) {
      if (cancelled) throw new Error('Reading stopped. Your photos are still here.');
      const asset = assets[index];
      onProgress(`Reading photo ${index + 1} of ${assets.length}`, index / assets.length);
      const runId = crypto.randomUUID();
      if (options.beforeImage) await Promise.race([options.beforeImage(asset), abortPromise]);
      let segmentationMode: 'single-block' | 'auto' = asset.role === 'nutrition' || asset.role === 'ingredients' || asset.side === 'back' ? 'single-block' : 'auto';
      await reader.setParameters({ tessedit_pageseg_mode: segmentationMode === 'single-block' ? PSM.SINGLE_BLOCK : PSM.AUTO });
      const rotation = (asset.rotation ?? options.rotation) as 0 | 90 | 180 | 270;
      const crop = options.cropTarget === asset.id ? options.crop : undefined;
      const image = await prepareImage(asset, rotation, options.contrast, crop, options.invert);
      const preparedBitmap = await createImageBitmap(image);
      const preparedImage = { width: preparedBitmap.width, height: preparedBitmap.height };
      preparedBitmap.close();
      let result = await Promise.race([reader.recognize(image, {}, { text: true, blocks: true, tsv: true }), abortPromise]);
      // Unknown-side photos are common in the consumer flow. AUTO can return
      // almost nothing for a tightly framed nutrition table; retry that image
      // once as a single block before treating its package evidence as empty.
      if (segmentationMode === 'auto') {
        const recovered = await retryShortAutoRecognition(result, async () => {
          await reader.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
          return Promise.race([reader.recognize(image, {}, { text: true, blocks: true, tsv: true }), abortPromise]);
        });
        result = recovered.result;
        segmentationMode = recovered.segmentationMode;
      }
      texts.push(result.data.text);
      confidence += result.data.confidence;
      captures.push({
        runId,
        imageId: asset.id,
        side: asset.side,
        sourceImage: { width: asset.width, height: asset.height },
        preparedImage,
        bboxCoordinateSpace: 'prepared-image-pixels',
        engine: { name: 'tesseract.js', version: BROWSER_OCR_ENGINE_VERSION, language: 'eng', confidenceScale: '0-100', segmentationMode },
        processing: {
          rotation,
          contrast: options.contrast,
          invert: options.invert ?? false,
          cropPercent: crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : null
        }
      });
      for (const [blockIndex, block] of (result.data.blocks ?? []).entries()) {
        for (const [paragraphIndex, paragraph] of (block.paragraphs ?? []).entries()) {
          for (const [lineIndex, line] of (paragraph.lines ?? []).entries()) {
            observations.push({
              id: crypto.randomUUID(),
              field: 'ocr-line',
              text: line.text,
              side: asset.side,
              confidence: line.confidence,
              bbox: line.bbox,
              ocrWords: line.words.map((word, wordIndex) => ({
                wordIndex,
                text: word.text,
                confidence: Number.isFinite(word.confidence) ? word.confidence : null,
                bbox: word.bbox
              })),
              origin: 'ocr',
              imageId: asset.id,
              readingOrder: { runId, blockIndex, paragraphIndex, lineIndex }
            });
          }
        }
      }
    }
    if (cancelled) throw new Error('Reading stopped. Your photos are still here.');
    return { text: texts.join('\n\n'), observations, confidence: confidence / assets.length, captures };
  } catch (error) {
    if (cancelled) throw new Error('Reading stopped or timed out. Try a smaller, tightly cropped photo.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    await worker?.terminate().catch(() => {});
  }
}
