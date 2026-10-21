import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';
import { captureFixture, noisyLabelFixture, proteinObservationFixture } from '../fixtures/noisy-label';

describe('OCR module parsing boundary', () => {
  it('retains original OCR lines while parsing only unambiguous structured values', () => {
    const result = parseLabel(noisyLabelFixture, {
      origin: 'ocr',
      observations: [proteinObservationFixture],
      ocrCaptures: [captureFixture]
    });

    expect(result.observations).toContainEqual(expect.objectContaining({
      id: 'ocr-protein-1',
      field: 'ocr-line',
      text: 'Protein 8.8 g',
      imageId: 'fixture-image-1',
      readingOrder: proteinObservationFixture.readingOrder
    }));
    expect(result.nutrients).toContainEqual(expect.objectContaining({ key: 'protein', value: 8.8, unit: 'g', basis: { amount: 100, unit: 'g', description: 'per 100 g' } }));
    expect(result.nutrients.some(nutrient => nutrient.key === 'protein' && nutrient.status === 'conflict')).toBe(true);
    expect(result.parserDiagnostics?.some(diagnostic => diagnostic.field === 'protein' && diagnostic.reasonCodes.includes('multiple-values'))).toBe(true);
    expect(result.observations.some(observation => observation.field === 'additive:955')).toBe(false);
  });

  it('accepts an app-supplied identity resolver without importing the knowledge module', () => {
    const result = parseLabel('Ingredients: oats, sweetener (INS 955)', {
      origin: 'user',
      resolveAdditives: () => ['955']
    });
    expect(result.observations.some(observation => observation.field === 'additive:955')).toBe(true);
  });
});
