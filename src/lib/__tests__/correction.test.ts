import { describe, expect, it } from 'vitest';
import { applyNutrientCorrection } from '../correction';
import { packageSchema } from '../contracts';
import { mergePackageEvidence } from '../merge-evidence';
import { parseLabel } from '../parser';

describe('user correction provenance', () => {
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
