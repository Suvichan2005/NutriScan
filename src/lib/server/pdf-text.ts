import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'node:path';

export type PdfText = { text: string; pagesRead: number; totalPages: number; truncated: boolean; extraction: 'selectable-text'|'ocr'|'mixed'|'empty'; ocrPages: number };
let ocrQueue = Promise.resolve();

async function acquireOcrSlot() {
  const previous = ocrQueue;
  let release!: () => void;
  ocrQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  return release;
}

function beforeDeadline<T>(promise: Promise<T>, deadline: number) {
  let timeout: ReturnType<typeof setTimeout>|undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('PDF OCR exceeded its time bound.')), Math.max(1, deadline - Date.now()));
  });
  return Promise.race([promise, timedOut]).finally(() => { if (timeout) clearTimeout(timeout); });
}

/** Extract bounded PDF text. OCR is opt-in, page-bounded and remains an unverified observation. */
export async function extractPdfText(data: Uint8Array, limits = { pages: 40, characters: 50_000 }, options: { ocr?: boolean; maxOcrPages?: number; maxOcrPixels?: number; ocrTimeoutMs?: number } = {}): Promise<PdfText> {
  const releaseOcr = options.ocr ? await acquireOcrSlot() : undefined;
  const loadingTask = getDocument({ data, verbosity: 0, stopAtErrors: true });
  let worker: { recognize: (image: Buffer) => Promise<{data:{text:string}}>; terminate: () => Promise<unknown> }|undefined;
  let ocrPages = 0;
  let selectablePages = 0;
  const ocrLimit = Math.min(2, Math.max(0, Math.floor(options.maxOcrPages ?? 0)));
  const maxOcrPixels = Math.min(4_000_000, Math.max(100_000, Math.floor(options.maxOcrPixels ?? 4_000_000)));
  const ocrDeadline = Date.now() + Math.min(30_000, Math.max(1_000, options.ocrTimeoutMs ?? 30_000));
  try {
    const document = await loadingTask.promise;
    const pageLimit = Math.min(document.numPages, limits.pages);
    const fragments: string[] = [];
    let characters = 0;
    let pagesRead = 0;
    let truncated = document.numPages > pageLimit;
    for (let pageNumber = 1; pageNumber <= pageLimit && characters < limits.characters; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let pageText = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').replace(/\s+/g, ' ').trim();
        if (pageText) selectablePages++;
        else if (options.ocr && ocrPages < ocrLimit) {
          if (!worker) {
            const [tesseract, canvas] = await Promise.all([import('tesseract.js'), import('@napi-rs/canvas')]);
            Object.assign(globalThis, {
              DOMMatrix: globalThis.DOMMatrix ?? canvas.DOMMatrix,
              ImageData: globalThis.ImageData ?? canvas.ImageData,
              Path2D: globalThis.Path2D ?? canvas.Path2D,
            });
            const startingWorker = tesseract.createWorker('eng', 1, { langPath: path.join(process.cwd(), 'public', 'ocr') });
            try { worker = await beforeDeadline(startingWorker, ocrDeadline); }
            catch (error) {
              void startingWorker.then(lateWorker => lateWorker.terminate()).catch(() => undefined);
              throw error;
            }
          }
          const canvasApi = await import('@napi-rs/canvas');
          const [viewX, viewY, viewWidth, viewHeight] = page.view;
          let scale = Math.min(2.78, Math.sqrt(maxOcrPixels / Math.max(1, viewWidth * viewHeight)));
          let viewport = page.getViewport({ scale });
          let width = Math.ceil(viewport.width);
          let height = Math.ceil(viewport.height);
          if (width * height > maxOcrPixels) {
            scale *= Math.sqrt(maxOcrPixels / (width * height)) * .99;
            viewport = page.getViewport({ scale });
            width = Math.ceil(viewport.width);
            height = Math.ceil(viewport.height);
          }
          if (width * height > maxOcrPixels || !Number.isFinite(viewX + viewY + viewWidth + viewHeight)) throw new Error('PDF OCR page dimensions exceed the local processing bound.');
          const canvas = canvasApi.createCanvas(width, height);
          const renderTask = page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport });
          try { await beforeDeadline(renderTask.promise, ocrDeadline); }
          catch (error) { renderTask.cancel(); throw error; }
          const result = await beforeDeadline(worker.recognize(canvas.toBuffer('image/png')), ocrDeadline);
          pageText = result.data.text.replace(/\s+/g, ' ').trim();
          ocrPages++;
        }
        if (pageText) {
          const remaining = limits.characters - characters;
          const clipped = pageText.slice(0, remaining);
          fragments.push(clipped);
          characters += clipped.length;
          if (clipped.length < pageText.length) truncated = true;
        }
        pagesRead++;
      } finally { page.cleanup(); }
    }
    if (pagesRead < Math.min(document.numPages, limits.pages)) truncated = true;
    const text = fragments.join('\n\n');
    const extraction = ocrPages && selectablePages ? 'mixed' : ocrPages ? 'ocr' : text ? 'selectable-text' : 'empty';
    return { text, pagesRead, totalPages: document.numPages, truncated, extraction, ocrPages };
  } finally {
    try { await worker?.terminate(); }
    finally {
      try { await loadingTask.destroy(); }
      finally { releaseOcr?.(); }
    }
  }
}
