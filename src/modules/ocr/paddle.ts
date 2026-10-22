import type { ImageAsset, Observation, OcrCapture, PackageData } from '../../lib/contracts';
import { prepareImage, type BrowserOcrOptions, type BrowserOcrResult } from './browser';

type PaddleBox = { text: string; score: number; poly: number[][] };
type PlacedBox = { box: PaddleBox; bounds: { x0: number; y0: number; x1: number; y1: number; cy: number; height: number } };
type PaddleEngine = { predict(image: Blob): Promise<Array<{ image: { width: number; height: number }; items: PaddleBox[] }>>; dispose(): Promise<void> };

let cachedEngine: PaddleEngine | undefined;
let cachedEngineLoading: Promise<PaddleEngine> | undefined;
let engineIdleTimer: ReturnType<typeof setTimeout> | undefined;
let paddleReadActive = false;
const engineIdleMs = 2 * 60 * 1000;

function clearEngineIdleTimer() {
  if (engineIdleTimer) clearTimeout(engineIdleTimer);
  engineIdleTimer = undefined;
}

function disposeCachedEngine() {
  clearEngineIdleTimer();
  const engine = cachedEngine;
  cachedEngine = undefined;
  cachedEngineLoading = undefined;
  if (engine) void engine.dispose().catch(() => {});
}

function retainEngineBriefly() {
  clearEngineIdleTimer();
  engineIdleTimer = setTimeout(disposeCachedEngine, engineIdleMs);
}

const nutritionText = /\b(nutri|nutrition|nutrient|energie|energy|calori|kcal|carbohyd|koolhyd|hidrato|sugar|suiker|az[uú]car|protein|eiwit|prote[ií]na|fat|vet|grasa|sodium|natrium|sodio|salt|zout|sal|ingredien|bestanddeel|per\s*100|serving|portion)\b/i;
const quantityText = /\b\d+(?:[.,]\d+)?\s*(?:g|mg|mcg|μg|ml|kcal|kj)\b/i;

/** A second OCR pass is useful when the first pass did not yield a usable table. */
export function shouldRunPaddleFallback(pkg: PackageData, assets: ImageAsset[]): boolean {
  const usableFields = new Set(pkg.nutrients.filter(item => item.status === 'observed' && item.basis).map(item => item.key));
  const unresolvedRows = pkg.parserDiagnostics?.some(item => item.decision !== 'accepted') ?? false;
  const missingMarkedPanel = assets.some(asset => asset.role === 'nutrition' && usableFields.size < 8 || asset.role === 'ingredients' && pkg.ingredients.length === 0);
  return usableFields.size < 5 || usableFields.size < 8 && unresolvedRows || missingMarkedPanel;
}

/** Prefer known label photos and OCR-dense candidates; bound repeated-model work on multi-photo scans. */
export function selectPaddleFallbackAssets(assets: ImageAsset[], observations: Observation[]): ImageAsset[] {
  if (!assets.length) return [];
  const scored = assets.map((asset, index) => {
    const lines = observations.filter(item => item.imageId === asset.id);
    const text = lines.map(item => item.text).join(' ');
    const labelHits = (text.match(/\b(?:nutrition|nutri|energy|energie|calori|carbohyd|sugar|suiker|az[uú]car|protein|eiwit|fat|vet|sodium|natrium|salt|zout|ingredien|per\s*100|serving)\w*\b/gi) ?? []).length;
    const quantityHits = (text.match(/\b\d+(?:[.,]\d+)?\s*(?:g|mg|mcg|ml|kcal|kj)\b/gi) ?? []).length;
    const score = (asset.role === 'nutrition' ? 100 : asset.role === 'ingredients' ? 80 : 0)
      + (asset.side === 'back' ? 12 : 0)
      + labelHits * 8
      + quantityHits * 2
      + Math.min(lines.length, 30) / 10
      + (nutritionText.test(text) ? 1 : 0)
      + (quantityText.test(text) ? 1 : 0);
    return { asset, score, lineCount: lines.length, index };
  });
  const explicit = scored.filter(item => item.asset.role === 'nutrition' || item.asset.role === 'ingredients');
  const candidates = explicit.length
    ? explicit
    : scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3);
  if (candidates.length) return candidates.slice(0, 3).map(item => item.asset);
  if (assets.length === 1) return assets;
  const bestObserved = scored.sort((a, b) => Number(b.asset.side === 'back') - Number(a.asset.side === 'back') || b.lineCount - a.lineCount || a.index - b.index)[0];
  return bestObserved ? [bestObserved.asset] : [];
}

function boundsFor(box: PaddleBox, width: number, height: number): PlacedBox['bounds'] | undefined {
  const points = box.poly.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!box.text.trim() || points.length < 4) return;
  const xs = points.map(point => Math.max(0, Math.min(width, point[0])));
  const ys = points.map(point => Math.max(0, Math.min(height, point[1])));
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  if (x1 <= x0 || y1 <= y0) return;
  return { x0, y0, x1, y1, cy: (y0 + y1) / 2, height: y1 - y0 };
}

function rowObservations(boxes: PaddleBox[], runId: string, asset: ImageAsset, width: number, height: number): Observation[] {
  const placed: PlacedBox[] = boxes.flatMap(box => {
    const bounds = boundsFor(box, width, height);
    return bounds ? [{ box, bounds }] : [];
  }).sort((a, b) => a.bounds.cy - b.bounds.cy || a.bounds.x0 - b.bounds.x0);
  const heights = placed.map(item => item.bounds.height).sort((a, b) => a - b);
  const typicalHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const toleranceY = Math.max(6, typicalHeight * 0.62);
  const groups: PlacedBox[][] = [];
  for (const item of placed) {
    let group = groups.find(items => Math.abs(items.reduce((sum, current) => sum + current.bounds.cy, 0) / items.length - item.bounds.cy) <= toleranceY);
    if (!group) { group = []; groups.push(group); }
    group.push(item);
  }
  groups.sort((a, b) => a.reduce((sum, item) => sum + item.bounds.cy, 0) / a.length - b.reduce((sum, item) => sum + item.bounds.cy, 0) / b.length);
  return groups.map((group, lineIndex) => {
    const ordered = group.sort((a, b) => a.bounds.x0 - b.bounds.x0);
    const bbox = {
      x0: Math.min(...ordered.map(item => item.bounds.x0)),
      y0: Math.min(...ordered.map(item => item.bounds.y0)),
      x1: Math.max(...ordered.map(item => item.bounds.x1)),
      y1: Math.max(...ordered.map(item => item.bounds.y1)),
    };
    let wordIndex = 0;
    const ocrWords = ordered.flatMap(item => item.box.text.trim().split(/\s+/).filter(Boolean).map(text => ({
      wordIndex: wordIndex++,
      text,
      confidence: Number.isFinite(item.box.score) ? Math.max(0, Math.min(100, item.box.score * 100)) : null,
      // Paddle reports text-region boxes, not word boxes. Tokens from one region
      // share its full bounds so downstream column matching stays conservative.
      bbox: { x0: item.bounds.x0, y0: item.bounds.y0, x1: item.bounds.x1, y1: item.bounds.y1 },
    })));
    return {
      id: crypto.randomUUID(),
      field: 'ocr-line',
      text: ordered.map(item => item.box.text.trim()).join(' '),
      side: asset.side,
      confidence: ordered.length ? ordered.reduce((sum, item) => sum + item.box.score * 100, 0) / ordered.length : null,
      bbox,
      ocrWords,
      origin: 'ocr',
      imageId: asset.id,
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex },
    } satisfies Observation;
  });
}

/** Runs the browser-local PP-OCRv6-small candidate and retains its detected geometry as OCR evidence. */
export async function readPaddleOcrImages(
  assets: ImageAsset[],
  onProgress: (label: string, progress: number) => void,
  signal: AbortSignal,
  options: BrowserOcrOptions,
): Promise<BrowserOcrResult> {
  if (!assets.length) return { text: '', observations: [], confidence: 0, captures: [] };
  if (signal.aborted) throw new Error('Reading stopped. Your photos are still here.');
  if (paddleReadActive) throw new Error('The on-device recovery reader is already in use.');
  paddleReadActive = true;
  clearEngineIdleTimer();
  onProgress('Loading the second on-device reader; model assets may download. Photos stay local.', 0.02);
  let engine: PaddleEngine | undefined;
  let succeeded = false;
  let rejectAbort: ((reason: Error) => void) | undefined;
  let stopped = false;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = (message: string) => {
    if (stopped) return;
    stopped = true;
    rejectAbort?.(new Error(message));
  };
  const abort = () => stop('Reading stopped. Your photos are still here.');
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => stop('The on-device recovery reader took too long to load. The first-pass reading is still available.'), 60000);
  let creation = cachedEngineLoading;
  if (!cachedEngine && !creation) {
    creation = import('@paddleocr/paddleocr-js').then(({ PaddleOCR }) => PaddleOCR.create({
      lang: 'en',
      ocrVersion: 'PP-OCRv6',
      worker: true,
      ortOptions: { backend: 'auto', wasmPaths: '/ocr/ort/', numThreads: 1, simd: true },
    })).then(async created => {
      const runtime = created as PaddleEngine;
      if (stopped || signal.aborted) {
        await runtime.dispose().catch(() => {});
        throw new Error('Reading stopped. Your photos are still here.');
      }
      cachedEngine = runtime;
      return runtime;
    });
    cachedEngineLoading = creation;
    void creation.catch(() => { if (cachedEngineLoading === creation) cachedEngineLoading = undefined; });
  }
  const texts: string[] = [];
  const observations: Observation[] = [];
  const captures: OcrCapture[] = [];
  let confidenceTotal = 0;
  let confidenceCount = 0;
  try {
    engine = cachedEngine ?? await Promise.race([creation!, abortPromise]);
    for (const [index, asset] of assets.entries()) {
      if (signal.aborted) throw new Error('Reading stopped. Your photos are still here.');
      onProgress(`Checking photo ${index + 1} of ${assets.length} with the second on-device reader`, 0.1 + index / assets.length * 0.85);
      const rotation = (asset.rotation ?? options.rotation) as 0 | 90 | 180 | 270;
      const crop = options.cropTarget === asset.id ? options.crop : undefined;
      const image = await prepareImage(asset, rotation, options.contrast, crop, options.invert ?? false);
      const [result] = await Promise.race([engine.predict(image), abortPromise]);
      if (!result) continue;
      const width = result.image.width, height = result.image.height;
      const runId = crypto.randomUUID();
      const lines = rowObservations(result.items as PaddleBox[], runId, asset, width, height);
      observations.push(...lines);
      texts.push(lines.map(line => line.text).join('\n'));
      captures.push({
        runId,
        imageId: asset.id,
        side: asset.side,
        sourceImage: { width: asset.width, height: asset.height },
        preparedImage: { width, height },
        bboxCoordinateSpace: 'prepared-image-pixels',
        engine: { name: '@paddleocr/paddleocr-js/PP-OCRv6-small', version: '0.4.2', language: 'en', confidenceScale: '0-100', segmentationMode: 'auto' },
        processing: { rotation, contrast: options.contrast, invert: options.invert ?? false, cropPercent: crop ?? null },
      });
      for (const item of result.items) {
        if (Number.isFinite(item.score)) { confidenceTotal += item.score * 100; confidenceCount++; }
      }
    }
    if (signal.aborted) throw new Error('Reading stopped. Your photos are still here.');
    succeeded = true;
    return { text: texts.filter(Boolean).join('\n\n'), observations, confidence: confidenceCount ? confidenceTotal / confidenceCount : 0, captures };
  } finally {
    signal.removeEventListener('abort', abort);
    clearTimeout(timeout);
    paddleReadActive = false;
    if (engine && succeeded && cachedEngine === engine) retainEngineBriefly();
    else if (engine) {
      if (cachedEngine === engine) { cachedEngine = undefined; cachedEngineLoading = undefined; }
      await engine.dispose().catch(() => {});
    }
  }
}
