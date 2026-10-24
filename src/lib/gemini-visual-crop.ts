import type { Observation, OcrCapture } from './contracts';

export type PixelRect = { x0: number; y0: number; x1: number; y1: number };
export type LabelDetailCrop = { preparedRect: PixelRect; originalRegion: { x: number; y: number; width: number; height: number }; score: number; regionRole?: 'nutrition-table'|'ingredients'|'label-detail' };
export const MAX_GEMINI_VISUAL_IMAGE_BYTES = 2_700_000;

export function canAddGeminiVisualImage(currentBytes: number, candidateBytes: number): boolean {
  return Number.isSafeInteger(currentBytes) && Number.isSafeInteger(candidateBytes)
    && currentBytes >= 0 && candidateBytes >= 0
    && currentBytes + candidateBytes <= MAX_GEMINI_VISUAL_IMAGE_BYTES;
}

/** Bounded display scaling for model inputs; upsampling never adds source evidence. */
export function geminiImageScale(width:number,height:number,maxEdge=2000,maxUpscale=1):number{
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||!Number.isFinite(maxEdge)||maxEdge<1||!Number.isFinite(maxUpscale)||maxUpscale<1)return 1;
  return Math.min(maxUpscale,maxEdge/Math.max(width,height));
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

type ClusteredLabelLine={observation:Observation;box:PixelRect;score:number};

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
    return [{ observation, box: bounded, score }];
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

/**
 * Separate adjacent printed sections when OCR word geometry shows distinct
 * nutrition and ingredient columns. The heading locations and observed word
 * boxes determine the crop; no product-specific image coordinates are used.
 */
export function suggestSpatialLabelCrops(capture:OcrCapture,observations:Observation[]):LabelDetailCrop[]{
  if(capture.bboxCoordinateSpace!=='prepared-image-pixels'||capture.preparedImage.width<1||capture.preparedImage.height<1)return [];
  const clusters=clusterLines(observations,capture);
  const selected=clusters.find(cluster=>cluster.some(line=>/\b(?:nutri(?:tional)?|energy|kcal|carbohydrates?|protein|sugars?|fat|sodium|salt|per\s*100)\b/i.test(line.observation.text))
    &&cluster.some(line=>/\bingredients?\b/i.test(line.observation.text)));
  if(!selected)return [];
  const labelBand={
    x0:Math.min(...selected.map(line=>line.box.x0)),y0:Math.min(...selected.map(line=>line.box.y0)),
    x1:Math.max(...selected.map(line=>line.box.x1)),y1:Math.max(...selected.map(line=>line.box.y1)),
  };
  const wordBandPadding=Math.max(capture.preparedImage.height*0.01,(labelBand.y1-labelBand.y0)*0.1);
  // Column/header token boxes can be retained on a linked OCR-derived basis
  // observation even when its parent line was normalized by the parser. Use
  // those boxes only as layout anchors; the crops still come from source pixels.
  const words=observations.filter(observation=>observation.origin==='ocr'&&observation.imageId===capture.imageId
    &&observation.readingOrder?.runId===capture.runId&&observation.ocrWords?.length)
    .flatMap(observation=>(observation.ocrWords??[]).flatMap(word=>{
    const box=word.bbox;
    if(box.x1<=box.x0||box.y1<=box.y0||box.x0>=capture.preparedImage.width||box.y0>=capture.preparedImage.height
      ||box.y1<labelBand.y0-wordBandPadding||box.y0>labelBand.y1+wordBandPadding)return [];
    return [{text:word.text.trim(),box:{x0:Math.max(0,box.x0),y0:Math.max(0,box.y0),x1:Math.min(capture.preparedImage.width,box.x1),y1:Math.min(capture.preparedImage.height,box.y1)} as PixelRect}];
  }));
  const layoutToken=(text:string)=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLocaleLowerCase('en');
  // Detection boxes sometimes retain the whole heading phrase as one token or
  // merge adjacent letters. Use a conservative heading prefix plus its box,
  // instead of requiring an exact OCR spelling before spatial separation.
  const nutritionHeading=words.find(word=>/^nutri/.test(layoutToken(word.text))&&layoutToken(word.text).length>=5)
    ??words.find(word=>/^(?:quantity|per\s*100\s*g|per100\s*g|per100g)$/.test(layoutToken(word.text)));
  const ingredientsHeading=words.find(word=>/^ingred/.test(layoutToken(word.text))&&layoutToken(word.text).length>=6);
  if(!nutritionHeading||!ingredientsHeading)return [];
  const headingGap=ingredientsHeading.box.x0-nutritionHeading.box.x1;
  const minimumGap=Math.max(capture.preparedImage.width*0.01,(ingredientsHeading.box.y1-ingredientsHeading.box.y0)*1.25);
  if(headingGap<minimumGap||labelBand.y1<=labelBand.y0)return [];
  const splitX=(nutritionHeading.box.x1+ingredientsHeading.box.x0)/2;
  // Some OCR readers merge a row across adjacent columns into one wide box.
  // Such a box remains part of the source image, but must not collapse the
  // column boundary while we estimate crop edges from independently bounded
  // observations.
  const leftWords=words.filter(word=>word.box.x0<splitX&&word.box.x1<=splitX);
  const rightWords=words.filter(word=>word.box.x1>splitX&&word.box.x0>=splitX);
  if(leftWords.length<2||rightWords.length<2)return [];
  const leftRight=Math.max(...leftWords.map(word=>word.box.x1));
  const rightLeft=Math.min(...rightWords.map(word=>word.box.x0));
  const regionGap=rightLeft-leftRight;
  if(regionGap<Math.max(capture.preparedImage.width*0.008,(ingredientsHeading.box.y1-ingredientsHeading.box.y0)*0.75))return [];

  const bandHeight=labelBand.y1-labelBand.y0;
  const padX=Math.max(capture.preparedImage.width*0.006,bandHeight*0.1);
  const padY=Math.max(capture.preparedImage.height*0.012,bandHeight*0.1);
  const toCrop=(x0:number,x1:number,regionRole:'nutrition-table'|'ingredients'):LabelDetailCrop|null=>{
    const rect={
      x0:Math.max(0,Math.floor(x0-padX)),y0:Math.max(0,Math.floor(labelBand.y0-padY)),
      x1:Math.min(capture.preparedImage.width,Math.ceil(x1+padX)),y1:Math.min(capture.preparedImage.height,Math.ceil(labelBand.y1+padY)),
    };
    if(rect.x1<=rect.x0||rect.y1<=rect.y0)return null;
    const area=((rect.x1-rect.x0)*(rect.y1-rect.y0))/(capture.preparedImage.width*capture.preparedImage.height);
    if(area<0.008||area>0.8)return null;
    const originalRegion=sourceCropForPreparedRect(rect,capture);
    if(!originalRegion||originalRegion.width*originalRegion.height>0.8)return null;
    return {preparedRect:rect,originalRegion,score:selected.reduce((sum,line)=>sum+line.score,0),regionRole};
  };
  const nutrition=toCrop(Math.min(...leftWords.map(word=>word.box.x0)),leftRight,'nutrition-table');
  const ingredients=toCrop(rightLeft,Math.max(...rightWords.map(word=>word.box.x1)),'ingredients');
  return nutrition&&ingredients?[nutrition,ingredients]:[];
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

/**
 * Recover a readable label view when OCR found text boxes but could not
 * recognize enough words to classify them. This uses only same-image OCR
 * geometry and never guesses a product-specific pixel location.
 */
export function suggestDenseTextCrops(capture: OcrCapture, observations: Observation[], limit = 2): LabelDetailCrop[] {
  if (capture.bboxCoordinateSpace !== 'prepared-image-pixels'
    || capture.preparedImage.width < 1 || capture.preparedImage.height < 1
    || !Number.isInteger(limit) || limit < 1) return [];
  const lines = observations.flatMap(observation => {
    const box = observation.bbox;
    if (observation.origin !== 'ocr' || observation.field !== 'ocr-line'
      || observation.imageId !== capture.imageId || observation.readingOrder?.runId !== capture.runId
      || !box || !observation.text.trim() || box.x1 <= box.x0 || box.y1 <= box.y0
      || box.x0 >= capture.preparedImage.width || box.y0 >= capture.preparedImage.height) return [];
    const bounded: PixelRect = {
      x0: Math.max(0, box.x0), y0: Math.max(0, box.y0),
      x1: Math.min(capture.preparedImage.width, box.x1), y1: Math.min(capture.preparedImage.height, box.y1),
    };
    if (bounded.x1 <= bounded.x0 || bounded.y1 <= bounded.y0) return [];
    const words = observation.ocrWords?.length ?? observation.text.trim().split(/\s+/).length;
    const cues = (labelCue.test(observation.text) ? 2 : 0) + (numericCue.test(observation.text) ? 1 : 0);
    return [{ observation, box: bounded, words, cues }];
  }).sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  if (lines.length < 2) return [];

  const heights = lines.map(line => line.box.y1 - line.box.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  const maxGap = Math.max(medianHeight * 5, capture.preparedImage.height * 0.08);
  const clusters: typeof lines[] = [];
  for (const line of lines) {
    const last = clusters.at(-1);
    const lastBottom = last ? Math.max(...last.map(item => item.box.y1)) : -Infinity;
    if (!last || line.box.y0 - lastBottom > maxGap) clusters.push([line]);
    else last.push(line);
  }

  const candidates = clusters.flatMap(cluster => {
    const wordCount = cluster.reduce((sum, line) => sum + line.words, 0);
    // A lone noisy OCR box is not enough evidence for a useful crop.
    if (cluster.length < 2 && wordCount < 5) return [];
    const box: PixelRect = {
      x0: Math.min(...cluster.map(line => line.box.x0)),
      y0: Math.min(...cluster.map(line => line.box.y0)),
      x1: Math.max(...cluster.map(line => line.box.x1)),
      y1: Math.max(...cluster.map(line => line.box.y1)),
    };
    const padX = Math.max(capture.preparedImage.width * 0.02, medianHeight * 0.8);
    const padY = Math.max(capture.preparedImage.height * 0.025, medianHeight * 0.8);
    const preparedRect = {
      x0: Math.max(0, Math.floor(box.x0 - padX)), y0: Math.max(0, Math.floor(box.y0 - padY)),
      x1: Math.min(capture.preparedImage.width, Math.ceil(box.x1 + padX)),
      y1: Math.min(capture.preparedImage.height, Math.ceil(box.y1 + padY)),
    };
    const areaRatio = ((preparedRect.x1 - preparedRect.x0) * (preparedRect.y1 - preparedRect.y0))
      / (capture.preparedImage.width * capture.preparedImage.height);
    if (areaRatio < 0.008 || areaRatio > 0.85) return [];
    const originalRegion = sourceCropForPreparedRect(preparedRect, capture);
    if (!originalRegion || originalRegion.width * originalRegion.height > 0.85) return [];
    const cueScore = cluster.reduce((sum, line) => sum + line.cues, 0);
    const score = cluster.length * 4 + Math.min(wordCount, 24) + cueScore * 2 - areaRatio * 4;
    return [{ preparedRect, originalRegion, score, regionRole: 'label-detail' as const, areaRatio }];
  }).sort((a, b) => b.score - a.score || a.areaRatio - b.areaRatio);

  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const overlaps = selected.some(existing => {
      const x0 = Math.max(candidate.preparedRect.x0, existing.preparedRect.x0);
      const y0 = Math.max(candidate.preparedRect.y0, existing.preparedRect.y0);
      const x1 = Math.min(candidate.preparedRect.x1, existing.preparedRect.x1);
      const y1 = Math.min(candidate.preparedRect.y1, existing.preparedRect.y1);
      const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      const union = candidate.areaRatio + existing.areaRatio;
      return union > 0 && intersection / (union * capture.preparedImage.width * capture.preparedImage.height) > 0.7;
    });
    if (!overlaps) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected.map(({ areaRatio: _areaRatio, ...candidate }) => candidate);
}

/** Prefer the OCR run that can separate printed package sections spatially. */
export function selectBestLabelCropSet(captures: readonly OcrCapture[], observations: readonly Observation[]) {
  const candidates = captures.flatMap(capture => {
    const spatial = suggestSpatialLabelCrops(capture, [...observations]);
    if (spatial.length) return [{ capture, details: spatial, quality: 3, score: spatial.reduce((sum, crop) => sum + crop.score, 0) }];

    const recognized = suggestLabelDetailCrop(capture, [...observations]);
    if (recognized) return [{ capture, details: [recognized], quality: 2, score: recognized.score }];

    const dense = suggestDenseTextCrops(capture, [...observations]);
    return dense.length
      ? [{ capture, details: dense, quality: 1, score: dense.reduce((sum, crop) => sum + crop.score, 0) }]
      : [];
  });
  candidates.sort((a, b) => b.quality - a.quality || b.score - a.score);
  const best = candidates[0];
  return best ? { capture: best.capture, details: best.details } : null;
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
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
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
