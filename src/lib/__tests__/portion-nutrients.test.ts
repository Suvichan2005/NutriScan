import { describe, expect, it } from 'vitest';
import { packageSchema, packageReconstructionContentSchema, calculationSchema } from '../contracts';
import { parseLabel } from '../parser';
import { applyNutrientCorrection } from '../correction';
import { portionNutrientChoices } from '../portion-nutrients';
import { portionView, scalePortion } from '../portion-view';
import { calculationHasPackageEvidence } from '../calculation-provenance';

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

function extra(pkg: ReturnType<typeof fixture>['pkg'], edits = {}) {
  const original = pkg.reconstruction!.nutritionRows[0];
  pkg.reconstruction!.nutritionRows.push({ ...original, rowId: 'magnesium', nutrient: 'Magnesium', nutrientKey: null, printedLabel: 'Magnesium', printedValue: '80 mg', value: 80, unit: 'mg', ...edits });
}

describe('local nutrient exploration', () => {
  it('keeps separately printed subcomponents distinct even with the same mapped nutrient key', () => {
    const { pkg, calculation } = fixture();
    extra(pkg, { rowId: 'soluble', nutrient: 'Fibre', nutrientKey: 'fiber', printedLabel: 'Soluble fibre', value: 1, unit: 'g' });
    extra(pkg, { rowId: 'insoluble', nutrient: 'Fibre', nutrientKey: 'fiber', printedLabel: 'Insoluble fibre', value: 2, unit: 'g' });
    const choices = portionNutrientChoices(pkg, [calculation]).filter(item => !item.initial);
    expect(choices.map(item => item.label)).toEqual(['Soluble fibre', 'Insoluble fibre']);
    expect(choices.every(item => item.calculation !== null)).toBe(true);
  });
  it('offers arbitrary nutrients without inventing an enum identity or inheriting the selected nutrient evidence', () => {
    const { pkg, calculation } = fixture(); extra(pkg);
    const choices = portionNutrientChoices(pkg, [calculation]);
    expect(choices.filter(item => item.initial).map(item => item.label)).toEqual(['Carbohydrate']);
    const magnesium = choices.find(item => item.label === 'Magnesium')!.calculation!;
    expect(magnesium.nutrient).toBeNull(); expect(magnesium.result).toBeCloseTo(28.8);
    expect(magnesium.interpretationIds).toEqual(['magnesium']);
    expect(calculationHasPackageEvidence(magnesium, { package: pkg })).toBe(true);
    const pieces = portionView(calculation, pkg).options.find(option => option.unit === 'pieces')!;
    expect(scalePortion(magnesium, 6, pieces)).toBeCloseTo(57.6);
    expect(pkg.reconstruction!.nutritionRows[1].value).toBe(80);
  });
  it('preserves package-fraction conversion while changing displayed nutrients', () => {
    const { pkg, calculation } = fixture(); extra(pkg);
    const anchor = calculationSchema.parse({ ...calculation, countedPortion: undefined, portion: 100, result: 30, packagePortion: { packageCount: .5, netContentPerPackage: 200, unit: 'g', printedText: '200 g' } });
    const magnesium = portionNutrientChoices(pkg, [anchor]).find(item => item.label === 'Magnesium')!.calculation!;
    const packages = portionView(anchor, pkg).options.find(option => option.unit === 'packages')!;
    expect(scalePortion(magnesium, .25, packages)).toBe(40);
  });
  it('keeps separate printed bases instead of voting or summing them', () => {
    const { pkg, calculation } = fixture(); extra(pkg); extra(pkg, { rowId: 'magnesium-serving', value: 19.2, basisAmount: 24 });
    const choices = portionNutrientChoices(pkg, [calculation]).filter(item => item.label === 'Magnesium');
    expect(choices.map(item => item.basis)).toEqual(['per 100 g', 'per 24 g']);
    choices.forEach(item => expect(item.calculation!.result).toBeCloseTo(28.8));
  });
  it('disables missing and qualified values; an exact zero remains usable', () => {
    const { pkg, calculation } = fixture(); extra(pkg, { value: null }); extra(pkg, { rowId: 'limit', nutrient: 'Limit', qualifier: '<', value: .5 }); extra(pkg, { rowId: 'zero', nutrient: 'Zero', value: 0 });
    const choices = portionNutrientChoices(pkg, [calculation]);
    expect(choices.find(item => item.id === 'row:magnesium')!.calculation).toBeNull();
    expect(choices.find(item => item.id === 'row:limit')!.reason).toMatch(/limit/);
    expect(choices.find(item => item.id === 'row:zero')!.calculation!.result).toBe(0);
  });
  it('withholds same-basis contradictory readings including an initially supplied operation', () => {
    const { pkg, calculation } = fixture(); extra(pkg, { rowId: 'conflicting-carb', nutrient: 'Carbohydrate', nutrientKey: 'carbohydrate', printedLabel: 'Carbohydrate', value: 45, unit: 'g' });
    expect(portionNutrientChoices(pkg, [calculation]).every(item => item.calculation === null)).toBe(true);
  });
  it('does not assume mass/volume equivalence or permit percentage quantities', () => {
    const { pkg, calculation } = fixture('ml'); extra(pkg, { basisUnit: 'g' }); extra(pkg, { rowId: 'percent', unit: '%' });
    const choices = portionNutrientChoices(pkg, [calculation]);
    expect(choices.filter(item => !item.initial).every(item => item.calculation === null)).toBe(true);
  });
  it('uses the current user correction and excludes superseded interpretation values', () => {
    const { pkg, calculation } = fixture();
    const corrected = applyNutrientCorrection(pkg, { key: 'carbohydrate', value: 15, unit: 'g', basisAmount: 100, basisUnit: 'g', sourceObservationIds: calculation.observationIds });
    const available = portionNutrientChoices(corrected, [calculation]).filter(item => item.calculation);
    expect(available).toHaveLength(1); expect(available[0].calculation!.input).toBe(15);
    expect(available[0].calculation!.inputOrigin).toBe('user-correction');
  });
  it('rejects absent provenance and impossible mass', () => {
    const { pkg, calculation } = fixture(); extra(pkg, { evidence: { observationIds: ['not-retained'], imageRegions: [] } }); extra(pkg, { rowId: 'impossible', nutrientKey: 'protein', nutrient: 'Protein', printedLabel: 'Protein', unit: 'g', value: 120 });
    expect(portionNutrientChoices(pkg, [calculation]).filter(item => !item.initial).every(item => item.calculation === null)).toBe(true);
  });
});

