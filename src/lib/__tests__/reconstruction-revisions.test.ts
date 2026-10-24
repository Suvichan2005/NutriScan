import { describe, expect, it } from 'vitest';
import { packageReconstructionContentSchema, packageReconstructionSchema, packageSchema, type PackageReconstructionContent } from '../contracts';
import { activateReconstructionRevision, decideReconstructionUpdate, mergeCompatibleReconstruction } from '../reconstruction-revisions';

const evidence = { observationIds: [], imageRegions: [] };
const row = (rowId: string, value: number, basisAmount: number, basisText: string) => ({
  rowId, nutrient: 'Carbohydrates', printedLabel: 'CARBOHYDRATES', printedValue: `${value} g`, value,
  unit: 'g', columnLabel: basisText, basisText, basisAmount, basisUnit: 'g' as const, qualifier: null,
  status: 'provisional' as const, evidence,
});

function content(overrides: Partial<PackageReconstructionContent> = {}): PackageReconstructionContent {
  return packageReconstructionContentSchema.parse({
    identity: { brand: 'Bisk Farm', name: 'Sugar Free Cream Cracker', variant: null, status: 'provisional', evidence },
    serving: { printedText: '2 biscuits approximately 13.4 g', quantity: 13.4, unit: 'g', pieceCount: 2, pieceDescription: 'biscuits', status: 'provisional', evidence },
    nutritionRows: [row('carbohydrate-100g', 69.29, 100, 'Per 100 g'), row('carbohydrate-serving', 9.28, 13.4, 'Per serving')],
    ingredients: [{ position: 0, name: 'Refined wheat flour', printedText: 'Refined wheat flour (maida) (89.98%)', printedPercentage: 89.98, normalizedName: 'Refined wheat flour', status: 'provisional', evidence }],
    additives: [],
    statements: [{ kind: 'claim', label: 'Sugar free', text: 'Sugar free', status: 'provisional', evidence }],
    regions: [], unresolved: [], interpretationNote: 'Provisional visual interpretation.',
    ...overrides,
  });
}

const saved = (value = content()) => packageReconstructionSchema.parse({
  ...value, revision: 4, updatedAt: '2026-10-23T00:00:00.000Z', model: 'gemini-test', current: true,
});

describe('package reconstruction revision promotion', () => {
  it('accepts the first interpretation without requiring heuristic parser support', () => {
    expect(decideReconstructionUpdate(undefined, content())).toEqual({ promote: true, reason: 'initial' });
  });

  it('keeps a fuller saved reading active when a recheck drops a serving-basis row and package details', () => {
    const next = content({
      serving: null,
      nutritionRows: [row('carbohydrate-100g-new', 69.29, 100, 'Per 100 g')],
      ingredients: [],
      statements: [],
    });
    expect(decideReconstructionUpdate(saved(), next)).toEqual({ promote: false, reason: 'omits-saved-details' });
  });

  it('does not promote contradictory nutrient or ingredient readings', () => {
    const changedRows = content({ nutritionRows: [row('carbohydrate-100g-new', 69.98, 100, 'Per 100 g'), row('carbohydrate-serving', 9.28, 13.4, 'Per serving')] });
    const changedIngredient = content({ ingredients: [{ position: 0, name: 'Refined wheat flour', printedText: 'Refined wheat flour (maida) (69.98%)', printedPercentage: 69.98, normalizedName: 'Refined wheat flour', status: 'provisional', evidence }] });
    expect(decideReconstructionUpdate(saved(), changedRows)).toEqual({ promote: false, reason: 'disagrees-with-saved-reading' });
    expect(decideReconstructionUpdate(saved(), changedIngredient)).toEqual({ promote: false, reason: 'disagrees-with-saved-reading' });
  });

  it('promotes a genuinely additive revision that preserves all existing structured details', () => {
    const next = content({ nutritionRows: [...content().nutritionRows, {
      ...row('protein-100g', 11.42, 100, 'Per 100 g'), nutrient: 'Protein', printedLabel: 'PROTEIN', printedValue: '11.42 g',
    }] });
    expect(decideReconstructionUpdate(saved(), next)).toEqual({ promote: true, reason: 'preserves-and-adds' });
  });

  it('merges complementary rechecks instead of discarding non-conflicting ingredients and additives', () => {
    const active = saved(content({
      nutritionRows: [
        { ...row('carbohydrate-100g', 69.29, 100, 'Per 100 g'), rowId: 'carbohydrate-100g' },
        { ...row('added-sugars-100g', 0, 100, 'Per 100 g'), rowId: 'added-sugars-100g', nutrient: 'Added sugars', printedLabel: 'ADDED SUGARS' },
        { ...row('sugars-100g', 0.5, 100, 'Per 100 g'), rowId: 'sugars-100g', nutrient: 'Total sugars', printedLabel: 'TOTAL SUGARS', qualifier: '<' },
      ],
    }));
    const candidate = content({
      nutritionRows: [
        { ...row('carbohydrate-100g-r2', 69.29, 100, 'Per 100 g'), rowId: 'carbohydrate-100g-r2' },
        { ...row('added-sugars-100g-r2', 0, 100, 'Per 100 g'), rowId: 'added-sugars-100g-r2', nutrient: 'Added sugars', printedLabel: 'ADDED SUGARS' },
      ],
      ingredients: ['Refined wheat flour (Maida)', 'Hydrogenated vegetable oil (Palm, Palmolein)', 'Edible vegetable oil (Palm, Palmolein)', 'Salt', 'Edible starch (Corn)', 'Whey powder', 'Yeast', 'Raising agents [500(ii), 503(ii)]', 'Emulsifier [450(i)]', 'Dough conditioner (223)', 'Acidity regulator [330, 450(i)]', 'Flour treatment agent (1100)', 'Oligofructose'].map((name, position) => ({
        position,
        name,
        printedText: position === 0 ? 'Refined wheat flour (Maida) (89.98%)' : name,
        printedPercentage: position === 0 ? 89.98 : null,
        normalizedName: position === 0 ? 'Refined wheat flour' : null,
        status: 'provisional' as const,
        evidence,
      })),
      additives: Array.from({ length: 8 }, (_, index) => ({ printedName: `Additive ${index}`, code: `${300 + index}`, normalizedName: null, status: 'provisional' as const, evidence })),
    });

    const merged = mergeCompatibleReconstruction(active, candidate);
    expect(merged.conflicts).toEqual([]);
    expect(merged.content.nutritionRows).toHaveLength(3);
    expect(merged.content.ingredients.map(item => item.name)).toEqual([
      'Refined wheat flour', 'Hydrogenated vegetable oil (Palm, Palmolein)', 'Edible vegetable oil (Palm, Palmolein)', 'Salt', 'Edible starch (Corn)', 'Whey powder', 'Yeast', 'Raising agents [500(ii), 503(ii)]', 'Emulsifier [450(i)]', 'Dough conditioner (223)', 'Acidity regulator [330, 450(i)]', 'Flour treatment agent (1100)', 'Oligofructose',
    ]);
    expect(merged.content.additives).toHaveLength(8);
    expect(merged.content.nutritionRows.find(item => item.nutrient === 'Carbohydrates')?.value).toBe(69.29);
    expect(decideReconstructionUpdate(active, merged.content)).toEqual({ promote: true, reason: 'preserves-and-adds' });
  });

  it('coalesces equivalent explicit and textual bases without merging distinct serving columns', () => {
    const active = saved(content({
      nutritionRows: [row('carbohydrate-100g', 69.29, 100, 'Per 100 g')],
    }));
    const equivalentTextBasis = {
      ...row('carbohydrate-100g-recheck', 69.29, 100, 'per 100 grams'),
      basisAmount: null,
      basisUnit: null,
    };
    const servingBasis = row('carbohydrate-serving', 9.28, 13.4, 'Per serving (13.4 g)');

    const merged = mergeCompatibleReconstruction(active, content({
      nutritionRows: [equivalentTextBasis, servingBasis],
    }));

    expect(merged.conflicts).toEqual([]);
    expect(merged.content.nutritionRows).toHaveLength(2);
    expect(merged.content.nutritionRows.map(item => item.value)).toEqual([69.29, 9.28]);
  });

  it('keeps conflicting values out of the merged active candidate', () => {
    const active = saved();
    const candidate = content({ nutritionRows: [row('carbohydrate-100g-other', 69.98, 100, 'Per 100 g')] });
    const merged = mergeCompatibleReconstruction(active, candidate);
    expect(merged.conflicts).toContain('nutrition.carbohydrate');
    expect(merged.content.nutritionRows.find(item => item.rowId === 'carbohydrate-100g')?.value).toBeNull();
    expect(merged.content.nutritionRows.find(item => item.rowId === 'carbohydrate-100g')?.status).toBe('conflict');
    expect(merged.content.unresolved.some(item => item.reason.includes('69.29 g per 100 g') && item.reason.includes('69.98 g per 100 g'))).toBe(true);
  });

  it('activates an explicitly selected alternative and archives the former active revision', () => {
    const active=saved();
    const alternative=packageReconstructionSchema.parse({...content({interpretationNote:'Alternative reading.'}),revision:5,updatedAt:'2026-10-23T00:01:00.000Z',model:'gemini-recheck',current:false});
    const pkg=packageSchema.parse({id:'revision-test',name:'Bisk Farm crackers',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],reconstruction:active,reconstructionHistory:[alternative],observations:[],rawText:'',warnings:[],synthetic:false,createdAt:'2026-10-23T00:00:00.000Z'});
    const selected=activateReconstructionRevision(pkg,5);
    expect(selected?.reconstruction).toMatchObject({revision:6,current:true,model:'local evidence merge r4+r5'});
    expect(selected?.reconstructionHistory).toEqual([
      expect.objectContaining({revision:4,current:false}),
      expect.objectContaining({revision:5,current:false}),
    ]);
    expect(activateReconstructionRevision(pkg,999)).toBeNull();
  });

  it('preserves complementary fields when an archived partial reading is selected', () => {
    const active = saved(content({
      nutritionRows: [
        { ...row('carbohydrate-100g', 69.29, 100, 'Per 100 g'), rowId: 'carbohydrate-100g' },
        { ...row('added-sugars-100g', 0, 100, 'Per 100 g'), rowId: 'added-sugars-100g', nutrient: 'Added sugars', printedLabel: 'ADDED SUGARS' },
        { ...row('sugars-100g', 0.5, 100, 'Per 100 g'), rowId: 'sugars-100g', nutrient: 'Total sugars', printedLabel: 'TOTAL SUGARS', qualifier: '<' },
      ],
    }));
    const alternative = packageReconstructionSchema.parse({
      ...content({
        nutritionRows: [
          { ...row('carbohydrate-100g-alt', 69.29, 100, 'Per 100 g'), rowId: 'carbohydrate-100g-alt' },
          { ...row('added-sugars-100g-alt', 0, 100, 'Per 100 g'), rowId: 'added-sugars-100g-alt', nutrient: 'Added sugars', printedLabel: 'ADDED SUGARS' },
        ],
        ingredients: [...content().ingredients, { position: 1, name: 'Salt', printedText: 'Salt', printedPercentage: null, normalizedName: 'Salt', status: 'provisional' as const, evidence }],
        additives: [{ printedName: 'Antioxidant', code: '319', normalizedName: null, status: 'provisional' as const, evidence }],
      }),
      revision: 5, updatedAt: '2026-10-23T00:01:00.000Z', model: 'gemini-recheck', current: false,
    });
    const pkg = packageSchema.parse({ id: 'merge-activation-test', name: 'Bisk Farm crackers', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], reconstruction: active, reconstructionHistory: [alternative], observations: [], rawText: '', warnings: [], synthetic: false, createdAt: '2026-10-23T00:00:00.000Z' });

    const selected = activateReconstructionRevision(pkg, 5);
    expect(selected?.reconstruction).toMatchObject({ revision: 6, current: true, model: 'local evidence merge r4+r5' });
    expect(selected?.reconstruction?.nutritionRows).toHaveLength(3);
    expect(selected?.reconstruction?.ingredients).toHaveLength(2);
    expect(selected?.reconstruction?.additives).toHaveLength(1);
    expect(selected?.reconstructionHistory).toEqual([
      expect.objectContaining({ revision: 4, current: false }),
      expect.objectContaining({ revision: 5, current: false }),
    ]);
  });

  it('combines complementary fields while withholding a conflicting flour percentage', () => {
    const active = saved(content({
      nutritionRows: [
        { ...row('carbohydrate-100g', 69.29, 100, 'Per 100 g'), rowId: 'carbohydrate-100g' },
        { ...row('added-sugars-100g', 0, 100, 'Per 100 g'), rowId: 'added-sugars-100g', nutrient: 'Added sugars', printedLabel: 'ADDED SUGARS' },
        { ...row('sugars-100g', 0.5, 100, 'Per 100 g'), rowId: 'sugars-100g', nutrient: 'Total sugars', printedLabel: 'TOTAL SUGARS', qualifier: '<' },
      ],
      ingredients: [{ ...content().ingredients[0], printedPercentage: 69.98, printedText: 'Refined wheat flour (maida) (69.98%)' }],
    }));
    const alternative = packageReconstructionSchema.parse({
      ...content({
        nutritionRows: [
          { ...row('carbohydrate-100g-alt', 69.29, 100, 'Per 100 g'), rowId: 'carbohydrate-100g-alt' },
          { ...row('added-sugars-100g-alt', 0, 100, 'Per 100 g'), rowId: 'added-sugars-100g-alt', nutrient: 'Added sugars', printedLabel: 'ADDED SUGARS' },
        ],
        ingredients: [
          { ...content().ingredients[0], printedPercentage: 89.98, printedText: 'Refined wheat flour (maida) (89.98%)' },
          { position: 1, name: 'Salt', printedText: 'Salt', printedPercentage: null, normalizedName: 'Salt', status: 'provisional' as const, evidence },
        ],
      }),
      revision: 5, updatedAt: '2026-10-23T00:01:00.000Z', model: 'gemini-recheck', current: false,
    });
    const pkg = packageSchema.parse({ id: 'conflicting-merge-test', name: 'Bisk Farm crackers', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [], reconstruction: active, reconstructionHistory: [alternative], observations: [], rawText: '', warnings: [], synthetic: false, createdAt: '2026-10-23T00:00:00.000Z' });

    const merged = mergeCompatibleReconstruction(active, alternative);
    const selected = activateReconstructionRevision(pkg, 5);
    const flour = selected?.reconstruction?.ingredients.find(item => item.name.toLowerCase().includes('flour'));
    expect(merged.conflicts).toContain('ingredient.refined wheat flour');
    expect(merged.content.nutritionRows).toHaveLength(3);
    expect(merged.content.ingredients).toHaveLength(2);
    expect(flour).toMatchObject({ status: 'conflict', printedPercentage: null, printedText: 'Refined wheat flour' });
    expect(selected?.reconstruction?.unresolved.some(item => item.reason.includes('69.98%') && item.reason.includes('89.98%'))).toBe(true);
    expect(selected?.reconstructionHistory?.find(item => item.revision === 4)?.ingredients[0].printedPercentage).toBe(69.98);
    expect(selected?.reconstructionHistory?.find(item => item.revision === 5)?.ingredients[0].printedPercentage).toBe(89.98);
    expect(selected?.reconstructionHistory).toHaveLength(2);
  });
});
