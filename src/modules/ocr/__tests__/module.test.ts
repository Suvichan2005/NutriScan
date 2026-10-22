import { describe, expect, it } from 'vitest';
import { parseLabel } from '../parser';
import { selectPaddleFallbackAssets, shouldRunPaddleFallback } from '../paddle';
import { captureFixture, noisyLabelFixture, proteinObservationFixture } from '../fixtures/noisy-label';
import type { Observation } from '../../../lib/contracts';

describe('OCR module parsing boundary', () => {
  it('does not promote a confused trans-fat table row into the package identity', () => {
    const line: Observation = { id: 'ocr-trans-fat-row', field: 'ocr-line', text: 'Trans Faty Acids omg', side: 'back', confidence: 96, origin: 'ocr', imageId: 'package-photo' };
    const result = parseLabel(line.text, { origin: 'ocr', observations: [line] });
    expect(result.name).toBe('Unidentified package');
  });

  it('keeps a confused micronutrient row out of the package identity', () => {
    const line: Observation = { id: 'ocr-iron-row', field: 'ocr-line', text: 'lron 4.9mg 1.7mg', side: 'back', confidence: 94, origin: 'ocr', imageId: 'package-photo' };
    const result = parseLabel(line.text, { origin: 'ocr', observations: [line] });
    expect(result.name).toBe('Unidentified package');
  });

  it('does not present localized nutrition headings or serving columns as product names', () => {
    const lines = ['Contenido energéticc 400 kJ', 'Voedingswaarde per 100g', '100g 15g Par 15g'];
    for (const [index, text] of lines.entries()) {
      const observation: Observation = { id: `ocr-nutrition-heading-${index}`, field: 'ocr-line', text, side: 'back', confidence: 96, origin: 'ocr', imageId: 'package-photo' };
      const result = parseLabel(text, { origin: 'ocr', observations: [observation] });
      expect(result.name).toBe('Unidentified package');
    }
  });

  it('selects a bounded package-panel fallback only when the first read leaves useful fields unresolved', () => {
    const complete = parseLabel([
      'Nutrition information per 100 g',
      'Energy 420 kcal',
      'Carbohydrate 65 g',
      'Total sugars 2 g',
      'Protein 10 g',
      'Total fat 15 g',
      'Saturated fat 3 g',
      'Sodium 850 mg'
    ].join('\n'), { origin: 'ocr' });
    const incomplete = parseLabel('Nutrition information per 100 g\nEnergy 420 kcal', { origin: 'ocr' });
    const panel = { id: 'panel', side: 'back', role: 'nutrition', name: 'Nutrition panel', blob: new Blob(), url: '', width: 1000, height: 800 } as const;
    const front = { ...panel, id: 'front', side: 'front', role: 'front' } as const;

    expect(shouldRunPaddleFallback(complete, [front])).toBe(false);
    expect(shouldRunPaddleFallback(incomplete, [panel])).toBe(true);
    expect(selectPaddleFallbackAssets([front, panel], [])).toEqual([panel]);
  });

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

  it('recovers an explicitly-unitized nutrient from a noisy multi-column OCR row only when word geometry aligns it to one basis', () => {
    const runId = 'geometry-run-1';
    const imageId = 'geometry-image-1';
    const capture = {
      ...captureFixture,
      runId,
      imageId,
      sourceImage: { width: 1000, height: 500 },
      preparedImage: { width: 1000, height: 500 }
    } as const;
    const header: Observation = {
      id: 'ocr-header-1', field: 'ocr-line', text: 'Nutrients Per 100g# Pec 359%', side: 'back', confidence: 78, origin: 'ocr', imageId,
      bbox: { x0: 50, y0: 20, x1: 830, y1: 42 },
      ocrWords: [
        { wordIndex: 0, text: 'Nutrients', confidence: 94, bbox: { x0: 50, y0: 20, x1: 190, y1: 42 } },
        { wordIndex: 1, text: 'Per', confidence: 80, bbox: { x0: 600, y0: 20, x1: 645, y1: 42 } },
        { wordIndex: 2, text: '100g#', confidence: 29, bbox: { x0: 650, y0: 20, x1: 690, y1: 42 } },
        { wordIndex: 3, text: 'Pec', confidence: 59, bbox: { x0: 735, y0: 20, x1: 770, y1: 42 } },
        { wordIndex: 4, text: '359%', confidence: 22, bbox: { x0: 780, y0: 20, x1: 830, y1: 42 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 0 }
    };
    const sugar: Observation = {
      id: 'ocr-sugar-1', field: 'ocr-line', text: 'RK   Sugar                      0g           0g', side: 'back', confidence: 53, origin: 'ocr', imageId,
      bbox: { x0: 100, y0: 100, x1: 820, y1: 122 },
      ocrWords: [
        { wordIndex: 0, text: 'RK', confidence: 0, bbox: { x0: 100, y0: 100, x1: 120, y1: 122 } },
        { wordIndex: 1, text: 'Sugar', confidence: 57, bbox: { x0: 130, y0: 100, x1: 200, y1: 122 } },
        { wordIndex: 2, text: '0g', confidence: 96, bbox: { x0: 600, y0: 100, x1: 620, y1: 122 } },
        { wordIndex: 3, text: '0g', confidence: 72, bbox: { x0: 800, y0: 100, x1: 820, y1: 122 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 1 }
    };

    const result = parseLabel(`${header.text}\n${sugar.text}`, { origin: 'ocr', observations: [header, sugar], ocrCaptures: [capture] });

    expect(result.nutrients.filter(nutrient => nutrient.key === 'sugars')).toEqual([
      expect.objectContaining({ key: 'sugars', value: 0, unit: 'g', basis: expect.objectContaining({ amount: 100, unit: 'g' }), status: 'observed' })
    ]);
    expect(result.observations.find(observation => observation.id === 'ocr-sugar-1')?.ocrWords).toEqual(sugar.ocrWords);
    expect(result.parserDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'sugars', decision: 'accepted', reasonCodes: ['multiple-values'],
        numericCandidates: [{ rawValueText: '0', value: 0, unit: 'g' }, { rawValueText: '0', value: 0, unit: 'g' }]
      })
    ]));
    expect(result.warnings.some(warning => warning.includes('other row values remain unassigned'))).toBe(true);

    const unitlessSugar: Observation = {
      ...sugar,
      id: 'ocr-sugar-unitless-1',
      text: 'RK   Sugar                      0           0',
      ocrWords: sugar.ocrWords?.map((word, index) => index < 2 ? word : { ...word, text: '0' })
    };
    const unitless = parseLabel(`${header.text}\n${unitlessSugar.text}`, { origin: 'ocr', observations: [header, unitlessSugar], ocrCaptures: [capture] });
    expect(unitless.nutrients.some(nutrient => nutrient.key === 'sugars')).toBe(false);
    expect(unitless.parserDiagnostics?.find(diagnostic => diagnostic.field === 'sugars')).toMatchObject({ decision: 'rejected', reasonCodes: expect.arrayContaining(['missing-unit']) });
  });

  it('keeps multi-value rows conflicted when the OCR basis has no usable matching geometry', () => {
    const result = parseLabel('Nutrition information per 100 g\nSugar 0 g 0 g', { origin: 'user' });
    expect(result.nutrients.filter(nutrient => nutrient.key === 'sugars')).toHaveLength(2);
    expect(result.nutrients.filter(nutrient => nutrient.key === 'sugars').every(nutrient => nutrient.status === 'conflict' && nutrient.basis === null)).toBe(true);
  });

  it('reconstructs both numeric columns only when OCR values align one-to-one with the printed bases', () => {
    const runId = 'two-column-run';
    const imageId = 'two-column-image';
    const capture = { ...captureFixture, runId, imageId, sourceImage: { width: 1000, height: 500 }, preparedImage: { width: 1000, height: 500 } } as const;
    const header: Observation = {
      id: 'two-column-header', field: 'ocr-line', text: 'Nutrients Per 100 g Per 35 g', side: 'back', confidence: 94, origin: 'ocr', imageId,
      bbox: { x0: 80, y0: 20, x1: 850, y1: 42 },
      ocrWords: [
        { wordIndex: 0, text: 'Nutrients', confidence: 96, bbox: { x0: 80, y0: 20, x1: 220, y1: 42 } },
        { wordIndex: 1, text: 'Per', confidence: 96, bbox: { x0: 500, y0: 20, x1: 545, y1: 42 } },
        { wordIndex: 2, text: '100', confidence: 96, bbox: { x0: 550, y0: 20, x1: 580, y1: 42 } },
        { wordIndex: 3, text: 'g', confidence: 96, bbox: { x0: 583, y0: 20, x1: 595, y1: 42 } },
        { wordIndex: 4, text: 'Per', confidence: 96, bbox: { x0: 720, y0: 20, x1: 765, y1: 42 } },
        { wordIndex: 5, text: '35', confidence: 96, bbox: { x0: 770, y0: 20, x1: 795, y1: 42 } },
        { wordIndex: 6, text: 'g', confidence: 96, bbox: { x0: 798, y0: 20, x1: 810, y1: 42 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 0 }
    };
    const sugar: Observation = {
      id: 'two-column-sugar', field: 'ocr-line', text: 'Sugar 0 g 0 g', side: 'back', confidence: 96, origin: 'ocr', imageId,
      bbox: { x0: 80, y0: 60, x1: 780, y1: 82 },
      ocrWords: [
        { wordIndex: 0, text: 'Sugar', confidence: 96, bbox: { x0: 80, y0: 60, x1: 180, y1: 82 } },
        { wordIndex: 1, text: '0', confidence: 96, bbox: { x0: 510, y0: 60, x1: 530, y1: 82 } },
        { wordIndex: 2, text: 'g', confidence: 96, bbox: { x0: 533, y0: 60, x1: 545, y1: 82 } },
        { wordIndex: 3, text: '0', confidence: 96, bbox: { x0: 730, y0: 60, x1: 750, y1: 82 } },
        { wordIndex: 4, text: 'g', confidence: 96, bbox: { x0: 753, y0: 60, x1: 765, y1: 82 } }
      ],
      readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: 1 }
    };

    const result = parseLabel(`${header.text}\n${sugar.text}`, { origin: 'ocr', observations: [header, sugar], ocrCaptures: [capture] });
    const recovered = result.nutrients.filter(nutrient => nutrient.key === 'sugars');
    expect(recovered).toEqual([
      expect.objectContaining({ key: 'sugars', value: 0, unit: 'g', basis: expect.objectContaining({ amount: 100, unit: 'g' }), status: 'observed' }),
      expect.objectContaining({ key: 'sugars', value: 0, unit: 'g', basis: expect.objectContaining({ amount: 35, unit: 'g' }), status: 'observed' })
    ]);
    expect(recovered.every(nutrient => nutrient.observationIds.some(id => result.observations.find(observation => observation.id === id)?.derivedFromObservationIds?.includes('two-column-header')))).toBe(true);
    expect(result.parserDiagnostics?.find(diagnostic => diagnostic.field === 'sugars')).toMatchObject({ decision: 'accepted', basisCandidates: [{ amount: 100, unit: 'g' }, { amount: 35, unit: 'g' }] });

    const oneValue: Observation = { ...sugar, id: 'two-column-sugar-one-value', text: 'Sugar 0 g', ocrWords: sugar.ocrWords?.slice(0, 3) };
    const unresolved = parseLabel(`${header.text}\n${oneValue.text}`, { origin: 'ocr', observations: [header, oneValue], ocrCaptures: [capture] });
    expect(unresolved.nutrients.filter(nutrient => nutrient.key === 'sugars').every(nutrient => nutrient.status === 'conflict' && nutrient.basis === null)).toBe(true);
  });
});
