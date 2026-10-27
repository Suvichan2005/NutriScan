import { describe, expect, it } from 'vitest';
import { packageSchema, packageReconstructionContentSchema, calculationSchema } from '../contracts';
import { parseLabel } from '../parser';
import { applyNutrientCorrection } from '../correction';
import { reconstructedIdentity } from '../reconstruction-presentation';
import { convertPortion, portionView, scalePortion } from '../portion-view';

function fixture(basisUnit: 'g' | 'ml' = 'g') {
  const original = parseLabel(`Synthetic package\nNutrition per 100 ${basisUnit}\nCarbohydrate 30 g`, { origin: 'user' });
  const observationIds = original.nutrients[0].observationIds;
  const evidence = { observationIds, imageRegions: [] };
  const content = packageReconstructionContentSchema.parse({
    identity: { brand: 'Example', name: 'Rice cakes', variant: null, status: 'clear', evidence },
    serving: { quantity: 24, unit: basisUnit, pieceCount: 2, pieceDescription: 'rice cakes', printedText: `2 rice cakes (24 ${basisUnit})`, status: 'provisional', evidence },
    nutritionRows: [{ rowId: 'carb', nutrient: 'Carbohydrate', nutrientKey: 'carbohydrate', printedLabel: 'Carbohydrate', printedValue: '30 g', value: 30, unit: 'g', columnLabel: 'Per 100', basisText: `per 100 ${basisUnit}`, basisAmount: 100, basisUnit, qualifier: null, status: 'provisional', evidence }],
    quantityDeclarations: [{ kind: 'net-content', printedText: `200 ${basisUnit}`, quantity: 200, unit: basisUnit, status: 'clear', evidence }],
    ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Synthetic structural fixture.',
  });
  const pkg = packageSchema.parse({ ...original, nutrients: [], reconstruction: { ...content, revision: 1, updatedAt: '2026-10-28T00:00:00Z', model: 'fixture', current: true } });
  const calculation = calculationSchema.parse({
    id: 'counted-operation', label: 'Carbohydrate', nutrient: 'carbohydrate', input: 30, inputUnit: 'g', basisAmount: 100,
    portion: 36, portionUnit: basisUnit, result: 10.8, unit: 'g', formula: '30 × 36 ÷ 100', observationIds,
    interpretationIds: ['carb'], assumptions: [], inputOrigin: 'model-interpretation',
    countedPortion: { amount: 3, unit: 'pieces', servingQuantity: 24, servingUnit: basisUnit, piecesPerServing: 2 },
  });
  return { pkg, calculation };
}

describe('evidence-owned portion presentation', () => {
  it('starts from the requested count and supports count, servings and mass without a workspace default', () => {
    const { pkg, calculation } = fixture();
    const view = portionView(calculation, pkg);
    expect(view.initial).toEqual({ amount: 3, unit: 'pieces' });
    const pieces = view.options.find(item => item.unit === 'pieces')!;
    const servings = view.options.find(item => item.unit === 'servings')!;
    const grams = view.options.find(item => item.unit === 'g')!;
    expect(pieces.label).toBe('rice cakes');
    expect(scalePortion(calculation, 5, pieces)).toBeCloseTo(18);
    expect(convertPortion(3, pieces, servings)).toBe(1.5);
    expect(convertPortion(3, pieces, grams)).toBe(36);
    expect(convertPortion(convertPortion(3, pieces, grams)!, grams, pieces)).toBe(3);
    expect(view.options.some(item => item.unit === 'ml')).toBe(false);
  });
  it('preserves a fractional serving request instead of presenting it as grams or pieces', () => {
    const { pkg, calculation } = fixture();
    const { piecesPerServing: _, ...count } = calculation.countedPortion!;
    const changed = calculationSchema.parse({ ...calculation, countedPortion: { ...count, amount: 1.5, unit: 'servings' } });
    expect(portionView(changed, pkg).initial).toEqual({ amount: 1.5, unit: 'servings' });
  });
  it('invalidates count conversions after serving or nutrient corrections', () => {
    const { pkg, calculation } = fixture();
    const changed = structuredClone(pkg); changed.reconstruction!.serving!.quantity = 25;
    expect(portionView(calculation, changed).options.map(item => item.unit)).toEqual(['g']);
    const corrected = applyNutrientCorrection(pkg, { key: 'carbohydrate', value: 15, unit: 'g', basisAmount: 100, basisUnit: 'g', sourceObservationIds: calculation.observationIds });
    expect(portionView(calculation, corrected).options.map(item => item.unit)).toEqual(['g']);
  });
  it('supports a partial liquid package only with its matching current net-content declaration', () => {
    const { pkg, calculation } = fixture('ml');
    const { countedPortion: _, ...base } = calculation;
    const packaged = calculationSchema.parse({ ...base, portion: 100, result: 30, packagePortion: { packageCount: .5, netContentPerPackage: 200, unit: 'ml', printedText: '200 ml' } });
    const view = portionView(packaged, pkg);
    expect(view.initial).toEqual({ amount: .5, unit: 'packages' });
    expect(scalePortion(packaged, .25, view.options.find(item => item.unit === 'packages')!)).toBe(15);
    expect(view.options.some(item => item.unit === 'g')).toBe(false);
    pkg.reconstruction!.quantityDeclarations![0].quantity = 180;
    expect(portionView(packaged, pkg).options.map(item => item.unit)).toEqual(['ml']);
  });
  it('rejects unsupported dimensions, zero, nonfinite and out-of-bound conversions', () => {
    const { pkg, calculation } = fixture();
    const grams = portionView(calculation, pkg).options[0];
    expect(convertPortion(20, grams, { ...grams, unit: 'ml', basisUnit: 'ml' })).toBeNull();
    for (const amount of [0, -1, NaN, Infinity, 10_001]) expect(convertPortion(amount, grams, grams)).toBeNull();
    expect(scalePortion(calculation, 1, { unit: 'ml', label: 'ml', quantity: 1, basisUnit: 'ml' })).toBeNull();
  });
});

it('deduplicates identity components without dropping distinct variants or matching partial words', () => {
  expect(reconstructedIdentity({ brand: 'Example', name: 'EXAMPLE Rice Cakes Original', variant: 'Original' })).toBe('EXAMPLE Rice Cakes Original');
  expect(reconstructedIdentity({ brand: 'Example', name: 'Rice Cakes', variant: 'Original' })).toBe('Example Rice Cakes Original');
  expect(reconstructedIdentity({ brand: null, name: 'Originality', variant: 'Original' })).toBe('Originality Original');
});
