import type { Observation, OcrCapture } from './contracts';

export type PixelRect = { x0: number; y0: number; x1: number; y1: number };
export type LabelDetailCrop = { preparedRect: PixelRect; originalRegion: { x: number; y: number; width: number; height: number }; score: number };
export const MAX_GEMINI_VISUAL_IMAGE_BYTES = 2_700_000;

export function canAddGeminiVisualImage(currentBytes: number, candidateBytes: number): boolean {
  return Number.isSafeInteger(currentBytes) && Number.isSafeInteger(candidateBytes)
    && currentBytes >= 0 && candidateBytes >= 0
    && currentBytes + candidateBytes <= MAX_GEMINI_VISUAL_IMAGE_BYTES;
}

const labelCue = /\b(?:nutri(?:tion|tional)?|energy|kcal|kilojoules?|carbohydrates?|carbs?|sugars?|protein|proten|fat|sodium|salt|fibre|fiber|serving|ingredients?|allergen|allergy|contains?|may\s+contain|per\s*100)\b/i;
const numericCue = /\b\d+(?:[.,]\d+)?\s*(?:mg|g|kcal|kj|ml|%|percent)\b/i;
const headerCue = /\b(?:nutrition(?:al)?\s+information|ingredients?)\b/i;

type MappedPoint = { x: number; y: number };

function inverseRotation(x: number, y: number, rotation: OcrCapture['processing']['rotation']): MappedPoint {
  if (rotation === 90) return { x: y, y: 1 - x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270) return { x: 1 - y, y: x };
  return { x, y };
}

function sourceCropForPreparedRect(rect: PixelRect, capture: OcrCapture) {
  const { width: preparedWidth, height: preparedHeight } = capture.preparedImage;
  const preparedCorners = [
    [rect.x0 / preparedWidth, rect.y0 / preparedHeight],
    [rect.x1 / preparedWidth, rect.y0 / preparedHeight],
    [rect.x0 / preparedWidth, rect.y1 / preparedHeight],
    [rect.x1 / preparedWidth, rect.y1 / preparedHeight],
  ] as const;
  const base = capture.processing.cropPercent
    ? {
        x: capture.processing.cropPercent.x / 100,
        y: capture.processing.cropPercent.y / 100,
        width: capture.processing.cropPercent.width / 100,
        height: capture.processing.cropPercent.height / 100,
      }
    : { x: 0, y: 0, width: 1, height: 1 };
  const points = preparedCorners.map(([x, y]) => {
    const unrotated = inverseRotation(x, y, capture.processing.rotation);
    return { x: base.x + unrotated.x * base.width, y: base.y + unrotated.y * base.height };
  });
  const x0 = Math.max(0, Math.min(...points.map(point => point.x)));
  const y0 = Math.max(0, Math.min(...points.map(point => point.y)));
  const x1 = Math.min(1, Math.max(...points.map(point => point.x)));
  const y1 = Math.min(1, Math.max(...points.map(point => point.y)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function clusterLines(observations: Observation[], capture: OcrCapture) {
  const relevant = observations.flatMap(observation => {
    const box = observation.bbox;
    if (observation.origin !== 'ocr' || observation.field !== 'ocr-line' || observation.imageId !== capture.imageId || observation.readingOrder?.runId !== capture.runId || !box) return [];
    const text = observation.text.replace(/\s+/g, ' ').trim();
    if (!labelCue.test(text) && !numericCue.test(text)) return [];
    if (box.x1 <= box.x0 || box.y1 <= box.y0 || box.x0 >= capture.preparedImage.width || box.y0 >= capture.preparedImage.height) return [];
    const bounded: PixelRect = {
      x0: Math.max(0, box.x0),
      y0: Math.max(0, box.y0),
      x1: Math.min(capture.preparedImage.width, box.x1),
      y1: Math.min(capture.preparedImage.height, box.y1),
    };
    if (bounded.x1 <= bounded.x0 || bounded.y1 <= bounded.y0) return [];
    const score = (labelCue.test(text) ? 2 : 0) + (numericCue.test(text) ? 1 : 0) + (headerCue.test(text) ? 3 : 0);
    return [{ box: bounded, score }];
  }).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  if (!relevant.length) return [];

  const heights = relevant.map(line => line.box.y1 - line.box.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  const maxGap = Math.max(medianHeight * 5, capture.preparedImage.height * 0.08);
  const clusters: typeof relevant[] = [];
  for (const line of relevant) {
    const last = clusters.at(-1);
    const lastBottom = last ? Math.max(...last.map(item => item.box.y1)) : -Infinity;
    if (!last || line.box.y0 - lastBottom > maxGap) clusters.push([line]);
    else last.push(line);
  }
  return clusters;
}

/** Find a compact, OCR-linked printed-label region without interpreting its values. */
export function suggestLabelDetailCrop(capture: OcrCapture, observations: Observation[]): LabelDetailCrop | null {
  if (capture.bboxCoordinateSpace !== 'prepared-image-pixels' || capture.preparedImage.width < 1 || capture.preparedImage.height < 1) return null;
  const clusters = clusterLines(observations, capture);
  const ranked = clusters.map(lines => ({
    lines,
    score: lines.reduce((sum, line) => sum + line.score, 0),
  })).sort((a, b) => b.score - a.score || b.lines.length - a.lines.length);
  const selected = ranked[0];
  if (!selected || (selected.lines.length < 2 && selected.score < 5)) return null;

  const box: PixelRect = {
    x0: Math.min(...selected.lines.map(line => line.box.x0)),
    y0: Math.min(...selected.lines.map(line => line.box.y0)),
    x1: Math.max(...selected.lines.map(line => line.box.x1)),
    y1: Math.max(...selected.lines.map(line => line.box.y1)),
  };
  const padX = Math.max(capture.preparedImage.width * 0.025, (box.y1 - box.y0) * 0.12);
  const padY = Math.max(capture.preparedImage.height * 0.025, (box.y1 - box.y0) * 0.12);
  const preparedRect = {
    x0: Math.max(0, Math.floor(box.x0 - padX)),
    y0: Math.max(0, Math.floor(box.y0 - padY)),
    x1: Math.min(capture.preparedImage.width, Math.ceil(box.x1 + padX)),
    y1: Math.min(capture.preparedImage.height, Math.ceil(box.y1 + padY)),
  };
  const preparedAreaRatio = ((preparedRect.x1 - preparedRect.x0) * (preparedRect.y1 - preparedRect.y0)) / (capture.preparedImage.width * capture.preparedImage.height);
  if (preparedAreaRatio < 0.015 || preparedAreaRatio > 0.85) return null;
  const originalRegion = sourceCropForPreparedRect(preparedRect, capture);
  if (!originalRegion || originalRegion.width * originalRegion.height > 0.85) return null;
  return { preparedRect, originalRegion, score: selected.score };
}

/** Crop an already prepared OCR image so the OCR coordinates remain exact. */
export async function cropPreparedImage(source: Blob, rect: PixelRect): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const x0 = Math.max(0, Math.floor(rect.x0));
    const y0 = Math.max(0, Math.floor(rect.y0));
    const x1 = Math.min(bitmap.width, Math.ceil(rect.x1));
    const y1 = Math.min(bitmap.height, Math.ceil(rect.y1));
    if (x1 <= x0 || y1 <= y0) throw new Error('The package-label crop is empty.');
    const canvas = document.createElement('canvas');
    canvas.width = x1 - x0;
    canvas.height = y1 - y0;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare the package-label detail image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('The package-label crop could not be encoded.')),
      'image/jpeg',
      0.95,
    ));
  } finally {
    bitmap.close();
  }
}
