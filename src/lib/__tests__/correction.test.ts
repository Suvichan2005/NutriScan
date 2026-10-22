import { describe, expect, it } from 'vitest';
import { applyNutrientCorrection } from '../correction';
import { defaultProfile, packageSchema } from '../contracts';
import { buildAudit } from '../engine';
import { mergePackageEvidence } from '../merge-evidence';
import { parseLabel } from '../parser';

describe('user correction provenance', () => {
  it('recalculates from a correction while preserving the original OCR evidence', () => {
    const pkg = parseLabel('Nutrition per 100 g\nSodium 850 mg', { origin: 'ocr' });
    const before = buildAudit(pkg, 20, 'g', defaultProfile, 'How much sodium?');
    const corrected = applyNutrientCorrection(pkg, { key: 'sodium', value: 900, unit: 'mg', basisAmount: 100, basisUnit: 'g' });
    const after = buildAudit(corrected, 20, 'g', defaultProfile, 'How much sodium?');

    expect(before.calculations.find(item => item.nutrient === 'sodium')?.result).toBe(170);
    expect(after.calculations.find(item => item.nutrient === 'sodium')?.result).toBe(180);
    expect(corrected.nutrients.find(item => item.key === 'sodium')).toMatchObject({ value: 900, status: 'corrected', basis: { amount: 100, unit: 'g' } });
    expect(corrected.observations.some(item => item.origin === 'ocr' && item.text.includes('Sodium 850 mg'))).toBe(true);
    expect(corrected.observations.find(item => item.origin === 'user')?.supersedesObservationIds).toContain(pkg.nutrients.find(item => item.key === 'sodium')?.observationIds[0]);
  });

  it('rejects a unit incompatible with the selected nutrient', () => {
    const pkg = parseLabel('Nutrition per 100 g\nCarbohydrate 65 g', { origin: 'ocr' });
    expect(() => applyNutrientCorrection(pkg, { key: 'carbohydrate', value: 65, unit: 'mg', basisAmount: 100, basisUnit: 'g' })).toThrow(/unit does not match/);
    expect(pkg.nutrients.find(item => item.key === 'carbohydrate')).toMatchObject({ value: 65, unit: 'g', status: 'observed' });
  });

  it('keeps conflicting OCR readings and links a correction to every replaced reading', () => {
    const pkg = parseLabel('Nutrition per 100 g\nSodium 850 mg\nSodium 85 mg', { origin: 'ocr' });
    const corrected = applyNutrientCorrection(pkg, { key: 'sodium', value: 850, unit: 'mg', basisAmount: 100, basisUnit: 'g' });
    const correction = corrected.observations.find(observation => observation.origin === 'user' && observation.supersedesObservationIds);
    const originalSodium = pkg.nutrients.filter(nutrient => nutrient.key === 'sodium').flatMap(nutrient => nutrient.observationIds);

    expect(corrected.observations.filter(observation => observation.origin === 'ocr')).toEqual(pkg.observations.filter(observation => observation.origin === 'ocr'));
    expect(corrected.parserDiagnostics).toEqual(pkg.parserDiagnostics);
    expect(corrected.nutrients.filter(nutrient => nutrient.key === 'sodium')).toMatchObject([
      { value: 850, unit: 'mg', basis: { amount: 100, unit: 'g' }, status: 'corrected' },
    ]);
    expect(corrected.nutrients.find(nutrient => nutrient.key === 'sodium')?.observationIds).toEqual([correction?.id]);
    expect(correction?.supersedesObservationIds).toEqual(expect.arrayContaining(originalSodium));
    expect(packageSchema.safeParse(corrected).success).toBe(true);
  });

  it('rejects dangling, repeated and self-referential superseded observation links', () => {
    const pkg = parseLabel('Nutrition per 100 g\nSodium 850 mg\nSodium 85 mg', { origin: 'ocr' });
    const corrected = applyNutrientCorrection(pkg, { key: 'sodium', value: 850, unit: 'mg', basisAmount: 100, basisUnit: 'g' });
    const correction = corrected.observations.find(observation => observation.origin === 'user' && observation.supersedesObservationIds)!;
    const replaceLinks = (ids: string[]) => ({
      ...corrected,
      observations: corrected.observations.map(observation => observation.id === correction.id ? { ...observation, supersedesObservationIds: ids } : observation),
    });

    expect(packageSchema.safeParse(replaceLinks(['missing-observation'])).success).toBe(false);
    expect(packageSchema.safeParse(replaceLinks([correction.id])).success).toBe(false);
    expect(packageSchema.safeParse(replaceLinks([correction.supersedesObservationIds![0], correction.supersedesObservationIds![0]])).success).toBe(false);
    expect(packageSchema.safeParse({
      ...corrected,
      observations: corrected.observations.map(observation => observation.id === correction.id ? { ...observation, origin: 'ocr' as const } : observation),
    }).success).toBe(false);
  });

  it('retains correction links when an investigation adds unrelated package evidence', () => {
    const current = parseLabel('Nutrition per 100 g\nProtein 10 g', { origin: 'ocr' });
    const incoming = applyNutrientCorrection(
      parseLabel('Nutrition per 100 g\nSodium 850 mg', { origin: 'ocr' }),
      { key: 'sodium', value: 850, unit: 'mg', basisAmount: 100, basisUnit: 'g' },
    );
    const correction = incoming.observations.find(observation => observation.origin === 'user' && observation.supersedesObservationIds)!;
    const merged = mergePackageEvidence(current, incoming);

    expect(merged.observations.find(observation => observation.id === correction.id)?.supersedesObservationIds).toEqual(correction.supersedesObservationIds);
    expect(packageSchema.safeParse(merged).success).toBe(true);
  });
});
