import { describe, expect, it } from 'vitest';
import { packageSchema } from '../contracts';
import { parseLabel } from '../parser';
import { calculationsFromReconstruction, defaultPortion, hasExplicitPortionRequest, normalizeReconstructedServing, resolveQuestionPortion } from '../portion';

function reconstructedPackage(rows: Array<{
  rowId: string; nutrient: string; value: number | null; unit: string | null; basisAmount: number | null; basisUnit: 'g' | 'ml' | null; qualifier?: string | null;
}>) {
  const imageEvidence = { observationIds: [], imageRegions: [{ imageId: 'package-back', region: null }] };
  const base = parseLabel('Package label', { origin: 'user' });
  return packageSchema.parse({
    ...base,
    observations: [],
    visionCaptures: [{ runId: 'vision-1', imageId: 'package-back', side: 'back', sourceImage: { width: 900, height: 363 }, processing: { rotation: 0, contrast: false, invert: false, crop: null }, model: 'fixture' }],
    reconstruction: {
      identity: { brand: null, name: null, variant: null, status: 'provisional', evidence: imageEvidence },
      serving: { printedText: '2 biscuits, approximately 13.4 g', quantity: 13.4, unit: 'g', pieceCount: 2, pieceDescription: 'biscuits', status: 'provisional', evidence: imageEvidence },
      nutritionRows: rows.map(row => ({ ...row, printedLabel: row.nutrient, printedValue: row.value === null ? null : `${row.value} ${row.unit ?? ''}`.trim(), columnLabel: row.basisAmount ? `per ${row.basisAmount} ${row.basisUnit}` : null, basisText: row.basisAmount ? `per ${row.basisAmount} ${row.basisUnit}` : null, qualifier: row.qualifier ?? null, status: 'provisional', evidence: imageEvidence })),
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Image-linked fixture reading.',
      revision: 1, updatedAt: '2026-10-24T00:00:00.000Z', model: 'fixture-model', current: true,
    },
  });
}

describe('neutral reference amount',()=>{
  it('uses an explicitly declared package serving first',()=>{
    expect(defaultPortion({serving:{value:45,unit:'g'},nutrients:[{status:'observed',basis:{amount:100,unit:'g'}}]})).toEqual({value:45,unit:'g'});
  });
  it('uses a current provisional Gemini serving when no OCR-derived serving exists',()=>{
    expect(defaultPortion({reconstruction:{current:true,serving:{quantity:13.4,unit:'g',status:'provisional'}},nutrients:[{status:'observed',basis:{amount:100,unit:'g'}}]})).toEqual({value:13.4,unit:'g'});
    expect(defaultPortion({reconstruction:{current:false,serving:{quantity:13.4,unit:'g',status:'provisional'}},nutrients:[]})).toEqual({value:100,unit:'g'});
    expect(defaultPortion({serving:{value:45,unit:'g'},reconstruction:{current:true,serving:{quantity:13.4,unit:'g',status:'provisional'}},nutrients:[]})).toEqual({value:45,unit:'g'});
  });
  it('uses a clear label basis when the package gives no serving',()=>{
    expect(defaultPortion({nutrients:[{status:'observed',basis:{amount:100,unit:'ml'}}]})).toEqual({value:100,unit:'ml'});
    expect(defaultPortion({nutrients:[{status:'observed',basis:{amount:25,unit:'g'}}]})).toEqual({value:25,unit:'g'});
  });
  it('does not choose a serving amount with the wrong dimension for the label basis',()=>{
    expect(defaultPortion({serving:{value:200,unit:'ml'},nutrients:[{status:'observed',basis:{amount:100,unit:'g'}}]})).toEqual({value:100,unit:'g'});
  });
  it('uses a standardized reference when the label declares neither',()=>{
    expect(defaultPortion({netWeight:{value:750,unit:'ml'},nutrients:[]})).toEqual({value:100,unit:'ml'});
    expect(defaultPortion({nutrients:[]})).toEqual({value:100,unit:'g'});
  });
  it('does not use a conflicted nutrient basis as the default',()=>{
    expect(defaultPortion({nutrients:[{status:'conflict',basis:{amount:30,unit:'g'}}]})).toEqual({value:100,unit:'g'});
  });
});

describe('question-directed portions',()=>{
  it('uses the amount and unit in a first or follow-up question',()=>{
    expect(resolveQuestionPortion('How much sodium is in 50 g?',{value:30,unit:'g'})).toEqual({value:50,unit:'g'});
    expect(resolveQuestionPortion('What about 250 ml?',{value:30,unit:'g'})).toEqual({value:250,unit:'ml'});
  });
  it('uses half the declared pack when requested',()=>{
    expect(resolveQuestionPortion('How about half a pack?',{value:30,unit:'g'},{value:200,unit:'g'})).toEqual({value:100,unit:'g'});
  });
  it('identifies only explicit, supported portions for contextual calculator presentation',()=>{
    const serving={quantity:13.4,unit:'g' as const,status:'provisional',pieceCount:2,pieceDescription:'biscuits'};
    expect(hasExplicitPortionRequest('How much carbohydrate in 70 g?',undefined,serving)).toBe(true);
    expect(hasExplicitPortionRequest('What about two biscuits?',undefined,serving)).toBe(true);
    expect(hasExplicitPortionRequest('How about half the packet?',{value:200,unit:'g'},serving)).toBe(true);
    expect(hasExplicitPortionRequest('How much in one serving?',undefined,serving)).toBe(true);
    expect(hasExplicitPortionRequest('What can you tell me about this package?',undefined,serving)).toBe(false);
    expect(hasExplicitPortionRequest('How much is 3000 g?',undefined,serving)).toBe(false);
    expect(hasExplicitPortionRequest('What about two biscuits?',undefined,{...serving,status:'conflict'})).toBe(false);
  });
  it('maps an exact named piece count to the printed serving without estimating other counts',()=>{
    const serving={quantity:13.4,unit:'g' as const,status:'provisional',pieceCount:2,pieceDescription:'biscuits'};
    expect(resolveQuestionPortion('What about just two biscuits?',{value:100,unit:'g'},undefined,serving)).toEqual({value:13.4,unit:'g'});
    expect(resolveQuestionPortion('What about 2 BISCUITS?',{value:100,unit:'g'},undefined,serving)).toEqual({value:13.4,unit:'g'});
    expect(resolveQuestionPortion('What about one biscuit?',{value:100,unit:'g'},undefined,serving)).toEqual({value:100,unit:'g'});
    expect(resolveQuestionPortion('What about two biscuits?',{value:100,unit:'g'},undefined,{...serving,status:'conflict'})).toEqual({value:100,unit:'g'});
  });
  it('normalizes only explicit mass, unit, and piece details from the saved printed serving text',()=>{
    const raw={printedText:'SERVING SIZE: 2 biscuits (approx. 13.4 g)',quantity:null,unit:null,pieceCount:null,pieceDescription:null,status:'provisional'};
    const normalized=normalizeReconstructedServing(raw);
    expect(normalized).toMatchObject({quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',printedText:raw.printedText});
    expect(resolveQuestionPortion('What about just two biscuits?',{value:100,unit:'g'},undefined,raw)).toEqual({value:13.4,unit:'g'});
    expect(defaultPortion({reconstruction:{current:true,serving:raw},nutrients:[{status:'observed',basis:{amount:100,unit:'g'}}]})).toEqual({value:13.4,unit:'g'});
  });
  it('retains the piece count but withholds serving mass when the printed unit is absent',()=>{
    const raw={printedText:'Serving size: 2 biscuits (approx. 13.4)',quantity:null,unit:null,pieceCount:null,pieceDescription:null,status:'provisional'};
    expect(normalizeReconstructedServing(raw)).toMatchObject({quantity:null,unit:null,pieceCount:2,pieceDescription:'biscuits'});
    expect(resolveQuestionPortion('What about two biscuits?',{value:100,unit:'g'},undefined,raw)).toEqual({value:100,unit:'g'});
  });
  it('keeps the current portion when the question has no supported amount',()=>{
    expect(resolveQuestionPortion('What is this ingredient?',{value:45,unit:'ml'})).toEqual({value:45,unit:'ml'});
    expect(resolveQuestionPortion('Is 3000 g still supported?',{value:45,unit:'ml'})).toEqual({value:45,unit:'ml'});
  });
});

describe('calculations from saved package reconstruction',()=>{
  it('calculates the selected serving from a traceable provisional photo reading',()=>{
    const pkg=reconstructedPackage([{rowId:'carbs-r1',nutrient:'Carbohydrates',value:68.29,unit:'g',basisAmount:100,basisUnit:'g'}]);
    const calculation=calculationsFromReconstruction(pkg,13.4,'g')[0];
    expect(calculation).toMatchObject({nutrient:'carbohydrate',input:68.29,basisAmount:100,portion:13.4,result:68.29*13.4/100,unit:'g',imageIds:['package-back'],observationIds:[],interpretationIds:['carbs-r1']});
    expect(calculation.assumptions.join(' ')).toMatch(/not been independently verified/i);
    expect(calculation.evidenceText).toMatch(/unverified provisional package interpretation/i);
  });

  it('calculates separately printed nutrient components without treating them as conflicts',()=>{
    const pkg=reconstructedPackage([
      {rowId:'fiber-total',nutrient:'Dietary Fibre',value:10.2,unit:'g',basisAmount:100,basisUnit:'g'},
      {rowId:'fiber-soluble',nutrient:'Soluble Dietary Fibre',value:4.4,unit:'g',basisAmount:100,basisUnit:'g'},
      {rowId:'fiber-insoluble',nutrient:'Insoluble Dietary Fibre',value:5.8,unit:'g',basisAmount:100,basisUnit:'g'},
    ]);
    const calculations=calculationsFromReconstruction(pkg,70,'g');
    expect(calculations).toEqual(expect.arrayContaining([
      expect.objectContaining({nutrient:'fiber',label:'Dietary Fibre in 70 g',result:7.14,interpretationIds:['fiber-total']}),
      expect.objectContaining({nutrient:'fiber',label:'Soluble Dietary Fibre in 70 g',result:3.08,interpretationIds:['fiber-soluble']}),
      expect.objectContaining({nutrient:'fiber',label:'Insoluble Dietary Fibre in 70 g',result:4.06,interpretationIds:['fiber-insoluble']}),
    ]));
    expect(calculations).toHaveLength(3);
  });

  it('withholds conflicting rows, qualified amounts, missing values and dimension mismatches',()=>{
    const conflict=reconstructedPackage([
      {rowId:'carbs-a',nutrient:'Carbohydrates',value:68.29,unit:'g',basisAmount:100,basisUnit:'g'},
      {rowId:'carbs-b',nutrient:'Carbohydrates',value:69.29,unit:'g',basisAmount:100,basisUnit:'g'},
    ]);
    expect(calculationsFromReconstruction(conflict,13.4,'g')).toEqual([]);

    const unsuitable=reconstructedPackage([
      {rowId:'sugar-bound',nutrient:'Total sugars',value:0.5,unit:'g',basisAmount:100,basisUnit:'g',qualifier:'<'},
      {rowId:'unknown',nutrient:'Protein',value:null,unit:'g',basisAmount:100,basisUnit:'g'},
      {rowId:'volume',nutrient:'Sodium',value:100,unit:'mg',basisAmount:100,basisUnit:'ml'},
    ]);
    expect(calculationsFromReconstruction(unsuitable,13.4,'g')).toEqual([]);
  });
});
