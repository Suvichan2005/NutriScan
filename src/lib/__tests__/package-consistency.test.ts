import { describe, expect, it } from 'vitest';
import { packageSchema, packageReconstructionContentSchema, calculationSchema } from '../contracts';
import { parseLabel } from '../parser';
import { packageConsistencyIssues, resolvePackageConsistency, consistencyRange, additiveInterpretationChanges } from '../package-consistency';
import { packageWithRowCorrections } from '../reconstruction-correction';
import { refreshPortionCalculations } from '../portion-nutrients';
import { portionView, convertPortion } from '../portion-view';
import { evidencePhotoSelection } from '../reconstruction-evidence';
import { executeGeminiTool } from '../server/gemini-tools';
import { supersedePackageAnswers } from '../thread-presentation';
import { applyNutrientCorrection } from '../correction';

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

function pair(value = 63.29) {
  const data = fixture();
  const row = data.pkg.reconstruction!.nutritionRows[0];
  Object.assign(row, { value, printedValue: `${value} g` });
  data.pkg.reconstruction!.nutritionRows.push({ ...row, rowId: 'serving-carb', value: 9.28, printedValue: '9.28 g', basisAmount: 13.4, basisText: 'per serving', columnLabel: 'Per serving' });
  data.calculation = calculationSchema.parse({ ...data.calculation, input: value, result: value * .36 });
  return data;
}

describe('collaborative package consistency', () => {
  it.each(['carbohydrate','fiber'] as const)('does not re-ask about %s already superseded through the inspector correction path', key => {
    const {pkg}=pair();
    pkg.reconstruction!.nutritionRows.forEach(row=>Object.assign(row,{nutrient:key,printedLabel:key,nutrientKey:key}));
    const corrected=applyNutrientCorrection(pkg,{key,value:69.29,unit:'g',basisAmount:100,basisUnit:'g'});
    expect(packageConsistencyIssues(corrected)).toEqual([]);
    expect(corrected.reconstruction!.nutritionRows[0].value).toBe(63.29);
  });
  it('returns optional native clarification and conditional calculation receipts without waiting for user input', async () => {
    const {pkg}=pair();const issue=packageConsistencyIssues(pkg)[0];
    const context={question:'Explain this portion',package:pkg,visualImages:[],searchTerms:new Set<string>(),prepareImage:async()=>{throw Error('No image recovery needed');}};
    const result=await executeGeminiTool('clarify_package_reading',{issueId:issue.id},context);
    expect(result.clarificationIds).toEqual([issue.id]);expect(result.output.message).toContain('Do not wait');
    const calculation=await executeGeminiTool('calculate_nutrition',{nutrient:'carbohydrate',amount:40.2,unit:'g'},context);
    expect(calculation.status).toBe('ok');expect(calculation.calculations).toHaveLength(2);expect(calculation.calculations!.map(item=>item.result)).toEqual(expect.arrayContaining([expect.closeTo(25.44258),expect.closeTo(27.84)]));expect(calculation.output.consistency).toEqual(expect.arrayContaining([expect.objectContaining({id:issue.id,decision:'pending'})]));
    const skipped=resolvePackageConsistency(pkg,issue.id,'skip');
    expect((await executeGeminiTool('clarify_package_reading',{issueId:issue.id},{...context,package:skipped})).status).toBe('withheld');
    expect((await executeGeminiTool('clarify_package_reading',{issueId:'unknown'},context)).status).toBe('withheld');
  });
  it('keeps only requested calculator metadata during a local correction and leaves old prose untouched', () => {
    const {calculation}=fixture();
    const original={question:'My portion?',answer:'Earlier answer.',at:'2026-10-28T00:00:00Z',calculations:[calculation],uiComponents:[{type:'portion-calculator' as const,observationIds:[],sourceIds:[],calculationIds:[calculation.id]},{type:'nutrition-table' as const,observationIds:[],sourceIds:[],calculationIds:[]}]};
    const updated=supersedePackageAnswers([original],undefined,true)[0];
    expect(updated.outdated).toBe(true);expect(updated.answer).toBe(original.answer);expect(updated.uiComponents?.map(item=>item.type)).toEqual(['portion-calculator']);
    expect(original.uiComponents).toHaveLength(2);
  });
  it('reports changed same-code additive names as uncertain leads, not scientific or legal conclusions', () => {
    const { pkg } = fixture(); const evidence=pkg.reconstruction!.nutritionRows[0].evidence;
    pkg.reconstruction!.additives=[{printedName:'First enzyme interpretation',normalizedName:'First enzyme interpretation',code:'1100',status:'provisional',evidence}];
    pkg.reconstructionHistory=[{...structuredClone(pkg.reconstruction!),current:false,revision:2,additives:[{printedName:'Other enzyme interpretation',normalizedName:'Other enzyme interpretation',code:'1100',status:'provisional',evidence}]}];
    expect(additiveInterpretationChanges(pkg)[0].limitation).toContain('may be normalization or a misreading');
    pkg.reconstructionHistory[0].additives[0].code='1100(i)';
    expect(additiveInterpretationChanges(pkg)).toEqual([]);
  });
  it('detects material cross-column disagreement without changing either printed digit', () => {
    const { pkg } = pair(); const before = JSON.stringify(pkg);
    const issues = packageConsistencyIssues(pkg);
    expect(issues).toHaveLength(1); expect(issues[0].readings.map(item => item.row.value)).toEqual([63.29, 9.28]);
    expect(consistencyRange(issues[0], 40.2, 'g', 'g')![0]).toBeCloseTo(25.44258);
    expect(consistencyRange(issues[0], 40.2, 'g', 'g')![1]).toBeCloseTo(27.84);
    expect(JSON.stringify(pkg)).toBe(before);
  });
  it('accepts independently rounded coherent columns', () => {
    expect(packageConsistencyIssues(pair(69.29).pkg)).toEqual([]);
  });
  it('handles a different nutrient, volume bases and mass-unit conversion', () => {
    const { pkg } = pair();
    Object.assign(pkg.reconstruction!.nutritionRows[0], { nutrient: 'Potassium', nutrientKey: null, printedLabel: 'Potassium', value: 200, unit: 'mg', printedValue: '200 mg', basisUnit: 'ml' });
    Object.assign(pkg.reconstruction!.nutritionRows[1], { nutrient: 'Potassium', nutrientKey: null, printedLabel: 'Potassium', value: .03, unit: 'g', printedValue: '0.03 g', basisAmount: 15, basisUnit: 'ml' });
    expect(packageConsistencyIssues(pkg)).toEqual([]);
    Object.assign(pkg.reconstruction!.nutritionRows[1], { value: .02, printedValue: '0.02 g' });
    expect(packageConsistencyIssues(pkg)).toHaveLength(1);
  });
  it('does not compare limits, unknown quantities or mass against volume', () => {
    for (const edits of [{ qualifier: '<' }, { value: null }, { basisUnit: 'ml' as const }, { unit: '%' }]) {
      const { pkg } = pair(); Object.assign(pkg.reconstruction!.nutritionRows[1], edits);
      expect(packageConsistencyIssues(pkg)).toEqual([]);
    }
  });
  it('detects changed values across reconstructions only when they share retained source evidence', () => {
    const { pkg } = pair(); pkg.reconstruction!.nutritionRows.pop();
    const previous = structuredClone(pkg.reconstruction!); previous.current = false; previous.revision = 2;
    Object.assign(previous.nutritionRows[0], { value: 69.29, printedValue: '69.29 g', rowId: 'earlier-carb' });
    pkg.reconstructionHistory = [{...previous,current:false}];
    expect(packageConsistencyIssues(pkg)).toHaveLength(1);
    previous.nutritionRows[0].evidence = { observationIds: ['unrelated-image-reading'], imageRegions: [] };
    expect(packageConsistencyIssues(pkg)).toEqual([]);
  });
  it('persists skip while retaining values and allows revisiting the same choice', () => {
    const { pkg } = pair(); const issue = packageConsistencyIssues(pkg)[0];
    const skipped = packageSchema.parse(JSON.parse(JSON.stringify(resolvePackageConsistency(pkg, issue.id, 'skip'))));
    expect(packageConsistencyIssues(skipped)[0].decision?.decision).toBe('skip');
    expect(skipped.reconstruction).toEqual(pkg.reconstruction);
    const confirmed = resolvePackageConsistency(skipped, issue.id, 1);
    expect(confirmed.clarificationDecisions!.at(-1)!.decision).toBe('confirm');
    expect(packageConsistencyIssues(confirmed)).toEqual([]);
    expect(confirmed.reconstruction).toEqual(pkg.reconstruction);
    expect(packageWithRowCorrections(confirmed).reconstruction!.nutritionRows).toHaveLength(1);
  });
  it('refreshes arithmetic and preserves a requested count after confirmation without rewriting the original result', () => {
    const { pkg, calculation } = pair(); const issue = packageConsistencyIssues(pkg)[0];
    const corrected = resolvePackageConsistency(pkg, issue.id, 1);
    const refreshed = refreshPortionCalculations(corrected, [calculation]);
    expect(refreshed).toHaveLength(1); expect(refreshed[0].result).toBeCloseTo(9.28 * 36 / 13.4);
    expect(refreshed[0].countedPortion?.amount).toBe(3);
    expect(calculation.input).toBe(63.29); expect(pkg.reconstruction!.nutritionRows[0].value).toBe(63.29);
  });
  it('accepts a custom confirmed value through the existing correction contract', () => {
    const { pkg } = pair();
    const result = resolvePackageConsistency(pkg, packageConsistencyIssues(pkg)[0].id, 0, { value: 68.5, unit: 'g', basisAmount: 100, basisUnit: 'g' });
    expect(result.nutrients.find(item=>item.key==='carbohydrate')!.value).toBe(68.5);
    expect(result.reconstruction!.nutritionRows[0].value).toBe(63.29);
    expect(() => resolvePackageConsistency(pkg, 'unknown', 0)).toThrow();
    expect(() => resolvePackageConsistency(pkg, packageConsistencyIssues(pkg)[0].id, 99)).toThrow();
  });
  it('offers all supported portion units independently of the requested operation', () => {
    const { pkg, calculation } = fixture();
    const anchor = calculationSchema.parse({ ...calculation, countedPortion: undefined, portion: 100, result: 30, packagePortion: { packageCount: .5, netContentPerPackage: 200, unit: 'g', printedText: '200 g' } });
    const view = portionView(anchor, pkg);
    expect(view.options.map(item => item.unit)).toEqual(['g', 'servings', 'pieces', 'packages']);
    const packages = view.options.find(item => item.unit === 'packages')!;
    const pieces = view.options.find(item => item.unit === 'pieces')!;
    expect(convertPortion(.25, packages, pieces)).toBeCloseTo(50 / 12);
    expect(convertPortion(50 / 12, pieces, packages)).toBeCloseTo(.25);
  });
  it('selects a Vision-linked source photo without requiring an OCR line or fabricating a region', () => {
    expect(evidencePhotoSelection([], [{ imageId: 'back' }], [], ['front', 'back'])).toEqual({ linked: true, imageIds: ['back'] });
    expect(evidencePhotoSelection([], [{ imageId: 'missing' }], [], ['front'])).toEqual({ linked: true, imageIds: [] });
    expect(evidencePhotoSelection([], [], [], ['front', 'back'])).toEqual({ linked: false, imageIds: ['front', 'back'] });
  });
});
