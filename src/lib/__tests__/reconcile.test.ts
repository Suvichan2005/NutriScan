import { describe, it, expect } from 'vitest';
import { parseLabel } from '../parser';
import { appendVisionEvidence } from '../reconcile';
import { buildAudit } from '../engine';
import { defaultProfile } from '../contracts';

const capture = {
  runId: 'vision-run-1',
  imageId: 'package-photo-1',
  side: 'back' as const,
  sourceImage: { width: 1600, height: 2400 },
  processing: {
    rotation: 90 as const,
    contrast: true,
    invert: false,
    crop: { x: 0.1, y: 0.15, width: 0.8, height: 0.7 },
  },
  model: 'gemini-test',
};

const visionObservation = {
  id: 'vision-line-1',
  field: 'nutrition-table',
  text: 'Sodium may read 85 mg per 100 g',
  side: 'back' as const,
  confidence: 62,
  origin: 'vision' as const,
  imageId: capture.imageId,
  visionRunId: capture.runId,
};

describe('image interpretation evidence attachment', () => {
  it('keeps image interpretation separate from package facts and calculations', () => {
    const original = parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg', { origin: 'ocr' });
    const merged = appendVisionEvidence(original, capture, [visionObservation]);

    expect(merged.nutrients).toEqual(original.nutrients);
    expect(merged.name).toBe(original.name);
    expect(merged.ingredients).toEqual(original.ingredients);
    expect(merged.observations).toContainEqual(expect.objectContaining({
      id: visionObservation.id,
      text: visionObservation.text,
      origin: 'vision',
      imageId: capture.imageId,
      visionRunId: capture.runId,
    }));
    expect(merged.visionCaptures).toEqual([capture]);
    expect(buildAudit(merged, 30, 'g', defaultProfile).calculations).toEqual(
      buildAudit(original, 30, 'g', defaultProfile).calculations,
    );
  });

  it('rejects observations that do not link to the selected image capture', () => {
    const original = parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg', { origin: 'ocr' });

    expect(() => appendVisionEvidence(original, capture, [{
      ...visionObservation,
      imageId: 'different-photo',
    }])).toThrow();
  });

  it('preserves the crop and original-image provenance for each appended observation', () => {
    const original = parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg', { origin: 'ocr' });
    const merged = appendVisionEvidence(original, capture, [visionObservation]);

    expect(merged.visionCaptures?.[0]).toMatchObject({
      imageId: capture.imageId,
      sourceImage: capture.sourceImage,
      processing: capture.processing,
    });
    expect(merged.observations.find((observation) => observation.id === visionObservation.id))
      .toMatchObject({ imageId: capture.imageId, visionRunId: capture.runId, origin: 'vision' });
  });
});
