import { describe, expect, it } from 'vitest';
import type { Observation, OcrCapture } from '../contracts';
import { canAddGeminiVisualImage, MAX_GEMINI_VISUAL_IMAGE_BYTES, suggestLabelDetailCrop } from '../gemini-visual-crop';

function capture(rotation: OcrCapture['processing']['rotation'] = 0, cropPercent: OcrCapture['processing']['cropPercent'] = null): OcrCapture {
  const rotated = rotation === 90 || rotation === 270;
  return {
    runId: 'run-1', imageId: 'photo-1', side: 'back',
    sourceImage: { width: 1000, height: 500 },
    preparedImage: rotated ? { width: 300, height: 800 } : { width: 800, height: 300 },
    bboxCoordinateSpace: 'prepared-image-pixels',
    engine: { name: 'test', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' },
    processing: { rotation, contrast: false, invert: false, cropPercent },
  };
}

function line(id: string, text: string, bbox: Observation['bbox'], imageId = 'photo-1'): Observation {
  return { id, field: 'ocr-line', text, side: 'back', confidence: 70, bbox, origin: 'ocr', imageId, readingOrder: { runId: 'run-1', blockIndex: 0, paragraphIndex: 0, lineIndex: 0 } };
}

describe('OCR-guided Gemini detail region', () => {
  it('keeps an optional crop within the server aggregate image-byte ceiling', () => {
    expect(canAddGeminiVisualImage(MAX_GEMINI_VISUAL_IMAGE_BYTES - 1000, 1000)).toBe(true);
    expect(canAddGeminiVisualImage(MAX_GEMINI_VISUAL_IMAGE_BYTES - 999, 1000)).toBe(false);
    expect(canAddGeminiVisualImage(-1, 1)).toBe(false);
  });

  it('selects a compact label block and maps prepared pixels to the original image', () => {
    const result = suggestLabelDetailCrop(capture(), [
      line('header', 'NUTRITIONAL INFORMATION', { x0: 80, y0: 35, x1: 410, y1: 58 }),
      line('row', 'Energy 125 kcal Carbohydrates 62 g', { x0: 78, y0: 64, x1: 710, y1: 91 }),
      line('ingredients', 'INGREDIENTS: WHEAT FLOUR (MAIDA)', { x0: 270, y0: 96, x1: 710, y1: 122 }),
      line('other-side', 'Protein 99g', { x0: 40, y0: 30, x1: 180, y1: 60 }, 'photo-2'),
    ]);

    expect(result).not.toBeNull();
    expect(result!.preparedRect.x0).toBeGreaterThan(0);
    expect(result!.preparedRect.y0).toBe(24);
    expect(result!.preparedRect.y1).toBeGreaterThan(122);
    expect(result!.originalRegion.x).toBeGreaterThan(0);
    expect(result!.originalRegion.y).toBeGreaterThan(0);
    expect(result!.originalRegion.width * result!.originalRegion.height).toBeLessThan(0.85);
  });

  it('maps rotated and manually cropped OCR coordinates back to source-image space', () => {
    const result = suggestLabelDetailCrop(capture(90, { x: 10, y: 20, width: 80, height: 60 }), [
      line('header', 'NUTRITIONAL INFORMATION', { x0: 30, y0: 80, x1: 150, y1: 110 }),
      line('row', 'Protein 8 g per 100 g', { x0: 32, y0: 120, x1: 155, y1: 150 }),
    ]);

    expect(result).not.toBeNull();
    expect(result!.originalRegion.x).toBeGreaterThanOrEqual(0.1);
    expect(result!.originalRegion.x + result!.originalRegion.width).toBeLessThanOrEqual(0.9);
    expect(result!.originalRegion.y).toBeGreaterThanOrEqual(0.2);
    expect(result!.originalRegion.y + result!.originalRegion.height).toBeLessThanOrEqual(0.8);
    expect(result!.originalRegion.x).toBeLessThan(0.34);
    expect(result!.originalRegion.y).toBeLessThan(0.5);
  });

  it('abstains when OCR geometry is absent or the supposed crop would be nearly the whole image', () => {
    expect(suggestLabelDetailCrop(capture(), [
      { ...line('no-box', 'NUTRITIONAL INFORMATION', undefined), bbox: undefined },
    ])).toBeNull();

    expect(suggestLabelDetailCrop(capture(), [
      line('full-a', 'Nutrition information', { x0: 0, y0: 0, x1: 800, y1: 150 }),
      line('full-b', 'Energy Protein Fat Sodium per 100 g', { x0: 0, y0: 150, x1: 800, y1: 300 }),
    ])).toBeNull();
  });
});
