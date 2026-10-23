import { describe, expect, it } from 'vitest';
import { applyNutrientCorrection } from '../correction';
import { calculationEvidenceText, calculationSchema, defaultProfile, packageSchema, type Observation, type PackageData, type TentativeStructuredCandidate } from '../contracts';
import { buildAudit } from '../engine';
import { reconcileInterpretedNutrition } from '../interpreted-nutrients';
import { parseLabel } from '../parser';

const runId = 'ocr-run-1';
const imageId = 'package-back-1';

function word(text: string, wordIndex: number, x0: number, x1: number, y0: number) {
  return { wordIndex, text, confidence: 92, bbox: { x0, x1, y0, y1: y0 + 24 } };
}

function line(id: string, text: string, tokens: string[], boxes: Array<[number, number]>, y: number): Observation {
  const ocrWords = tokens.map((token, index) => word(token, index, boxes[index][0], boxes[index][1], y));
  return {
    id, field: 'ocr-line', text, side: 'back', confidence: 92, ocrWords, origin: 'ocr', imageId,
    bbox: { x0: Math.min(...ocrWords.map(item => item.bbox.x0)), y0: y, x1: Math.max(...ocrWords.map(item => item.bbox.x1)), y1: y + 24 },
    readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: y },
  };
}

function makePackage(rows = [{ value: '8.8', basis: '100' }]): PackageData {
  const observations: Observation[] = [];
  for (const [index, item] of rows.entries()) {
    const y = 100 + index * 80;
    observations.push(line(`row-${index}`, `Protein ${item.value} g`, ['Protein', item.value, 'g'], [[100, 225], [650, 690], [700, 730]], y));
    observations.push(line(`basis-${index}`, `Per ${item.basis} g`, ['Per', item.basis, 'g'], [[590, 620], [640, 680], [690, 710]], y - 40));
  }
  const base = parseLabel('unclassified package text', { origin: 'user' });
  return packageSchema.parse({
    ...base,
    name: 'Unidentified package',
    nutrients: [],
    observations,
    rawText: observations.map(item => item.text).join('\n'),
    ocrCaptures: [{
      runId, imageId, side: 'back', sourceImage: { width: 1000, height: 1000 }, preparedImage: { width: 1000, height: 1000 },
      bboxCoordinateSpace: 'prepared-image-pixels',
      engine: { name: 'fixture-reader', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' },
      processing: { rotation: 0, contrast: false, invert: false, cropPercent: null },
    }],
  });
}

function candidate(pkg: PackageData, rowIndex = 0): TentativeStructuredCandidate {
  const row = pkg.observations.find(item => item.id === `row-${rowIndex}`)!;
  const basis = pkg.observations.find(item => item.id === `basis-${rowIndex}`)!;
  const match = row.text.match(/Protein (\d+(?:\.\d+)?) g/)!;
  const basisAmount = Number(basis.text.match(/Per (\d+) g/)! [1]);
  return {
    candidateId: `candidate-protein-${rowIndex}`,
    kind: 'nutrient', field: 'protein', proposedValue: `${match[1]} g per ${basisAmount} g`, numericValue: Number(match[1]), unit: 'g',
    basis: { amount: basisAmount, unit: 'g', description: `per ${basisAmount} g` }, normalizedEntity: 'protein', status: 'tentative',
    observationIds: [row.id, basis.id], sourceIds: [],
    supportingSpans: [
      { kind: 'observation', id: row.id, quote: row.text },
      { kind: 'observation', id: basis.id, quote: basis.text },
    ],
    ocrWordEvidence: [
      { observationId: row.id, role: 'label', wordIndexes: [0] },
      { observationId: row.id, role: 'value', wordIndexes: [1] },
      { observationId: row.id, role: 'unit', wordIndexes: [2] },
      { observationId: basis.id, role: 'basis', wordIndexes: [0, 1, 2] },
    ],
    uncertainty: 'The model interpretation has not been checked against the original pixels.',
  };
}

describe('OCR-linked model nutrition interpretations', () => {
  it('uses an exact row and basis candidate for clearly labeled portion arithmetic without mutating package facts', () => {
    const pkg = makePackage();
    const modelReading = candidate(pkg);
    const before = structuredClone(pkg);

    const result = buildAudit(pkg, 20, 'g', defaultProfile, 'How much protein?', [modelReading]);

    expect(result.calculations).toContainEqual(expect.objectContaining({
      nutrient: 'protein', result: 1.76, interpretationIds: ['candidate-protein-0'], observationIds: ['row-0', 'basis-0'],
    }));
    expect(result.calculations.find(item => item.nutrient === 'protein')?.assumptions.join(' ')).toMatch(/unverified model interpretation/i);
    expect(pkg).toEqual(before);
    expect(pkg.nutrients).toEqual([]);
  });

  it('withholds a candidate when the proposed digits differ from the OCR number', () => {
    const pkg = makePackage();
    const wrong = { ...candidate(pkg), numericValue: 88, proposedValue: '88 g per 100 g' };
    const result = reconcileInterpretedNutrition(pkg, [wrong]);

    expect(result.readings).toEqual([]);
    expect(result.withheld[0].reason).toMatch(/number does not exactly match/i);
    expect(buildAudit(pkg, 20, 'g', defaultProfile, 'How much protein?', [wrong]).calculations).toEqual([]);
  });

  it('withholds a basis from another column even when the nutrient number is exact', () => {
    const pkg = makePackage();
    const wrong = { ...candidate(pkg), basis: { amount: 30, unit: 'g' as const, description: 'per serving' }, proposedValue: '8.8 g per 30 g' };
    const result = reconcileInterpretedNutrition(pkg, [wrong]);

    expect(result.readings).toEqual([]);
    expect(result.withheld[0].reason).toMatch(/basis does not exactly match/i);
  });

  it('withholds evidence whose word geometry extends beyond the captured image', () => {
    const pkg = makePackage();
    pkg.observations.find(item => item.id === 'row-0')!.ocrWords![0].bbox.x1 = 1001;
    const result = reconcileInterpretedNutrition(pkg, [candidate(pkg)]);

    expect(result.readings).toEqual([]);
    expect(result.withheld[0].reason).toMatch(/not all linked to exact OCR words/i);
  });

  it('uses the printed OCR basis wording instead of a model-provided description', () => {
    const pkg = makePackage();
    const modelReading = { ...candidate(pkg), basis: { ...candidate(pkg).basis!, description: 'per serving 30 g' } };
    const result = reconcileInterpretedNutrition(pkg, [modelReading]);

    expect(result.readings[0].basis).toEqual({ amount: 100, unit: 'g', description: 'Per 100 g' });
  });

  it('normalizes a case-variant unit before exposing a candidate to calculations', () => {
    const pkg = makePackage();
    const modelReading = { ...candidate(pkg), unit: 'G' };
    const result = reconcileInterpretedNutrition(pkg, [modelReading]);

    expect(result.readings[0].unit).toBe('g');
    expect(buildAudit(pkg, 20, 'g', defaultProfile, 'How much protein?', [modelReading]).calculations[0]).toMatchObject({ result: 1.76, unit: 'g' });
  });

  it('withholds cross-candidate value and serving-basis conflicts as a group', () => {
    const pkg = makePackage([{ value: '8.8', basis: '100' }, { value: '4.0', basis: '30' }]);
    const result = reconcileInterpretedNutrition(pkg, [candidate(pkg, 0), candidate(pkg, 1)]);

    expect(result.readings).toEqual([]);
    expect(result.withheld).toHaveLength(2);
    expect(result.withheld.every(item => /disagree across values, units, or printed bases/i.test(item.reason))).toBe(true);
  });

  it('keeps image-only readings out of calculations and preserves a user correction as the active value', () => {
    const pkg = makePackage();
    const imageOnly = { ...candidate(pkg), candidateId: 'visual-protein', observationIds: [], sourceIds: [], supportingSpans: [], ocrWordEvidence: [], visualEvidence: [{ imageId, visibleText: 'Protein 8.8 g per 100 g', region: null }] };
    expect(buildAudit(pkg, 20, 'g', defaultProfile, 'How much protein?', [imageOnly]).calculations).toEqual([]);

    const interpreted = candidate(pkg);
    const corrected = applyNutrientCorrection(pkg, { key: 'protein', value: 9.2, unit: 'g', basisAmount: 100, basisUnit: 'g', sourceObservationIds: interpreted.observationIds });
    const result = buildAudit(corrected, 20, 'g', defaultProfile, 'How much protein?', [interpreted]);
    expect(result.calculations.find(item => item.nutrient === 'protein')).toMatchObject({ input: 9.2, result: 1.84 });
    expect(result.calculations.find(item => item.nutrient === 'protein')?.interpretationIds).toBeUndefined();
    expect(corrected.observations.find(item => item.origin === 'user')?.derivedFromObservationIds).toEqual(interpreted.observationIds);
  });

  it('uses a complete attached-photo reading for labeled arithmetic while retaining image provenance and unverified status', () => {
    const pkg = makePackage();
    const photoReading: TentativeStructuredCandidate = {
      ...candidate(pkg), candidateId: 'visual-protein', observationIds: [], sourceIds: [], supportingSpans: [], ocrWordEvidence: [],
      visualEvidence: [{ imageId, visibleText: 'PROTEIN 8.8 g · QUANTITY PER 100 g', region: { x: 0.08, y: 0.22, width: 0.6, height: 0.18 } }],
    };

    expect(reconcileInterpretedNutrition(pkg, [photoReading]).readings).toEqual([]);
    const audit = buildAudit(pkg, 20, 'g', defaultProfile, 'How much protein?', [photoReading], [imageId]);
    const calculation = audit.calculations.find(item => item.nutrient === 'protein');

    expect(calculation).toMatchObject({ result: 1.76, observationIds: [], imageIds: [imageId], interpretationIds: ['visual-protein'] });
    expect(calculation?.assumptions.join(' ')).toMatch(/unverified model interpretation/i);
    expect(calculationSchema.parse({ ...calculation, evidenceText: calculationEvidenceText(calculation!) })).toMatchObject({ imageIds: [imageId] });
    expect(pkg.nutrients).toEqual([]);
  });

  it('withholds a photo reading when its region omits the printed basis or is not attached', () => {
    const pkg = makePackage();
    const photoReading: TentativeStructuredCandidate = {
      ...candidate(pkg), candidateId: 'visual-protein', observationIds: [], sourceIds: [], supportingSpans: [], ocrWordEvidence: [],
      visualEvidence: [{ imageId, visibleText: 'PROTEIN 8.8 g', region: { x: 0.08, y: 0.22, width: 0.6, height: 0.18 } }],
    };
    const noBasis = reconcileInterpretedNutrition(pkg, [photoReading], [imageId]);
    const unattached = reconcileInterpretedNutrition(pkg, [{ ...photoReading, visualEvidence: [{ ...photoReading.visualEvidence![0], visibleText: 'PROTEIN 8.8 g · QUANTITY PER 100 g' }] }], []);

    expect(noBasis.readings).toEqual([]);
    expect(noBasis.withheld[0].reason).toMatch(/printed column or serving basis/i);
    expect(unattached.readings).toEqual([]);
  });

  it('joins distinct photo regions for a serving column, exact row and printed serving declaration', () => {
    const pkg = makePackage();
    const servingReading: TentativeStructuredCandidate = {
      ...candidate(pkg), candidateId: 'visual-carb-serving', field: 'carbohydrate', normalizedEntity: 'carbohydrate', proposedValue: '9.28 g per serving (13.4 g)', numericValue: 9.28,
      basis: { amount: 13.4, unit: 'g', description: 'quantity per serving' }, observationIds: [], sourceIds: [], supportingSpans: [], ocrWordEvidence: [],
      visualEvidence: [
        { imageId, visibleText: 'CARBOHYDRATES 9.28 g', region: { x: 0.31, y: 0.49, width: 0.34, height: 0.05 } },
        { imageId, visibleText: 'QUANTITY PER SERVING', region: { x: 0.54, y: 0.35, width: 0.21, height: 0.06 } },
        { imageId, visibleText: 'SERVING SIZE: 2 BISCUITS (APPROX. 13.4 g)', region: { x: 0.1, y: 0.21, width: 0.5, height: 0.06 } },
      ],
    };

    const result = buildAudit(pkg, 13.4, 'g', defaultProfile, 'How much carbohydrate is in two biscuits?', [servingReading], [imageId]);

    expect(result.calculations.find(item => item.nutrient === 'carbohydrate')).toMatchObject({ input: 9.28, basisAmount: 13.4, portion: 13.4, result: 9.28, observationIds: [], imageIds: [imageId] });
  });

  it('lets a complete photo reading remain usable beside an OCR conflict without changing the conflicted package record', () => {
    const pkg = makePackage();
    pkg.nutrients = [{ key: 'protein', value: 8.4, unit: 'g', basis: { amount: 100, unit: 'g', description: 'per 100 g' }, observationIds: ['row-0'], status: 'conflict' }];
    const photoReading: TentativeStructuredCandidate = {
      ...candidate(pkg), candidateId: 'visual-protein', observationIds: [], sourceIds: [], supportingSpans: [], ocrWordEvidence: [],
      visualEvidence: [{ imageId, visibleText: 'PROTEIN 8.8 g · QUANTITY PER 100 g', region: { x: 0.08, y: 0.22, width: 0.6, height: 0.18 } }],
    };
    const audit = buildAudit(pkg, 20, 'g', defaultProfile, 'How much protein?', [photoReading], [imageId]);

    expect(audit.calculations.find(item => item.nutrient === 'protein')).toMatchObject({ input: 8.8, result: 1.76, imageIds: [imageId], observationIds: ['row-0'] });
    expect(pkg.nutrients[0]).toMatchObject({ value: 8.4, status: 'conflict' });
  });
});
