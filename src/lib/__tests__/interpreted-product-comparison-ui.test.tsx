import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { defaultProfile, packageReconstructionSchema, packageSchema, type Calculation, type Observation, type ProductRecord, type TentativeStructuredCandidate } from '../contracts';
import { buildAudit } from '../engine';
import { reconcileInterpretedNutrition } from '../interpreted-nutrients';
import { parseLabel } from '../parser';
import { productEvidenceSource } from '../product-evidence';
import { ThreadGenerativeUI } from '../../components/thread-generative-ui';
import { ThreadPublicProductRecord } from '../../components/thread-public-product-record';
import { PackageReconstructionView } from '../../components/package-reconstruction';
import { calculationsFromReconstruction } from '../portion';

const imageId = 'package-photo-1';
const runId = 'ocr-run-1';

it('keeps total, soluble and insoluble fibre identities distinct in a portion calculator',()=>{
  const base=parseLabel('Package label',{origin:'user'});
  const evidence={observationIds:[base.observations[0].id],imageRegions:[]};
  const pkg=packageSchema.parse({...base,reconstruction:{
    identity:{brand:null,name:'Example oats',variant:null,status:'provisional',evidence},serving:null,
    nutritionRows:[['Total Dietary Fibre',10.2],['Soluble Dietary Fibre',4.4],['Insoluble Dietary Fibre',5.8]].map(([name,value],index)=>({rowId:`fiber-${index}`,nutrient:index===0?'fiber':name,printedLabel:name,printedValue:`${value} g`,value,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence})),
    ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer fixture.',revision:1,updatedAt:'2026-10-25T00:00:00Z',model:'fixture',current:true,
  }});
  const calculations=calculationsFromReconstruction(pkg,52.5,'g');
  const markup=renderToStaticMarkup(<ThreadGenerativeUI question="Show the portion" components={[{type:'portion-calculator',observationIds:evidence.observationIds,sourceIds:[],calculationIds:calculations.map(item=>item.id)}]}
    pkg={pkg} audit={{...buildAudit(pkg,52.5,'g',defaultProfile,''),calculations}} portion={52.5} portionUnit="g" onPortionChange={()=>{}} onPortionUnitChange={()=>{}} onSaveCorrection={()=>true}
    canInspect={()=>false} isInspecting={()=>false} onInspect={()=>{}} candidates={[]} interpretedReadings={[]} sources={[]} selectedProduct={null}/>);
  for(const label of ['Total Dietary Fibre','Soluble Dietary Fibre','Insoluble Dietary Fibre'])expect(markup).toContain(label);
  for(const value of ['5.36 g','2.31 g','3.04 g'])expect(markup).toContain(value);
  const countMarkup=renderToStaticMarkup(<ThreadGenerativeUI question="Compare five pieces with the printed serving" components={[{type:'portion-calculator',observationIds:evidence.observationIds,sourceIds:[],calculationIds:calculations.map(item=>item.id),calculatorAmount:33.5,calculatorUnit:'g'}]}
    pkg={pkg} audit={{...buildAudit(pkg,52.5,'g',defaultProfile,''),calculations}} portion={52.5} portionUnit="g" onPortionChange={()=>{}} onPortionUnitChange={()=>{}} onSaveCorrection={()=>true}
    canInspect={()=>false} isInspecting={()=>false} onInspect={()=>{}} candidates={[]} interpretedReadings={[]} sources={[]} selectedProduct={null}/>);
  expect(countMarkup).toContain('value="33.5"');
  expect(countMarkup).toContain('3.42 g');
});

function makeObservation(id: string, text: string, tokens: string[], bounds: Array<[number, number]>, y: number): Observation {
  const ocrWords = tokens.map((word, wordIndex) => ({ wordIndex, text: word, confidence: 92, bbox: { x0: bounds[wordIndex][0], x1: bounds[wordIndex][1], y0: y, y1: y + 22 } }));
  return {
    id, field: 'ocr-line', text, side: 'back', confidence: 92, origin: 'ocr', imageId, ocrWords,
    bbox: { x0: Math.min(...ocrWords.map(word => word.bbox.x0)), y0: y, x1: Math.max(...ocrWords.map(word => word.bbox.x1)), y1: y + 22 },
    readingOrder: { runId, blockIndex: 0, paragraphIndex: 0, lineIndex: y },
  };
}

it('renders a reconciled missing nutrient in the selected-record comparison with OCR trace and unverified label', () => {
  const row = makeObservation('protein-row', 'Protein 8.8 g', ['Protein', '8.8', 'g'], [[100, 220], [650, 690], [700, 730]], 100);
  const basis = makeObservation('protein-basis', 'Per 100 g', ['Per', '100', 'g'], [[590, 620], [640, 680], [690, 710]], 60);
  const base = parseLabel('Package label', { origin: 'user' });
  const pkg = packageSchema.parse({
    ...base, name: 'Unidentified package', nutrients: [], observations: [row, basis], rawText: `${row.text}\n${basis.text}`,
    ocrCaptures: [{ runId, imageId, side: 'back', sourceImage: { width: 1000, height: 1000 }, preparedImage: { width: 1000, height: 1000 }, bboxCoordinateSpace: 'prepared-image-pixels', engine: { name: 'fixture-reader', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' }, processing: { rotation: 0, contrast: false, invert: false, cropPercent: null } }],
  });
  const candidate: TentativeStructuredCandidate = {
    candidateId: 'protein-reading-1', kind: 'nutrient', field: 'protein', proposedValue: '8.8 g per 100 g', numericValue: 8.8, unit: 'g',
    basis: { amount: 100, unit: 'g', description: 'Per 100 g' }, normalizedEntity: 'protein', status: 'tentative',
    observationIds: [row.id, basis.id], sourceIds: [], supportingSpans: [{ kind: 'observation', id: row.id, quote: row.text }, { kind: 'observation', id: basis.id, quote: basis.text }],
    ocrWordEvidence: [{ observationId: row.id, role: 'label', wordIndexes: [0] }, { observationId: row.id, role: 'value', wordIndexes: [1] }, { observationId: row.id, role: 'unit', wordIndexes: [2] }, { observationId: basis.id, role: 'basis', wordIndexes: [0, 1, 2] }],
    uncertainty: 'This fixture represents an OCR-linked model interpretation, not provider or photo-accuracy evidence.',
  };
  const interpretedReadings = reconcileInterpretedNutrition(pkg, [candidate]).readings;
  const selectedProduct: ProductRecord = {
    id: 'community-candidate-1', name: 'Example community candidate', brand: 'Example', barcode: '', quantity: '', countries: [], url: 'https://world.openfoodfacts.org/product/0000000000000',
    retrievedAt: '2026-10-22T00:00:00.000Z', lastModified: null, nutrients: [{ key: 'protein', value: 10, unit: 'g', basis: { amount: 100, unit: 'g' } }],
    ingredients: '', allergens: [], match: 'candidate', availability: 'local stock unverified',
  };
  const source = productEvidenceSource(selectedProduct, selectedProduct.retrievedAt)!;
  const recordCard = renderToStaticMarkup(<ThreadPublicProductRecord product={selectedProduct} querySource="label-text" identityConflict={false} canCompare={interpretedReadings.length > 0} otherCandidates={[]} onCompare={() => {}}/>);
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    components={[{ type: 'product-comparison', observationIds: [], sourceIds: [source.id], calculationIds: [] }]}
    pkg={pkg} audit={buildAudit(pkg, 30, 'g', defaultProfile, 'Compare protein', [candidate])} portion={30} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} candidates={[candidate]}
    interpretedReadings={interpretedReadings} sources={[source]} selectedProduct={selectedProduct}
  />);

  expect(interpretedReadings).toHaveLength(1);
  expect(recordCard).toContain('Compare with this label');
  expect(recordCard).not.toContain('disabled=""');
  expect(markup).toContain('8.8 g per 100 g');
  expect(markup).toContain('10 g per 100 g');
  expect(markup).toContain('Gemini interpretation · unverified against photo');
  expect(markup).toContain('Trace to OCR (2)');
  expect(markup).toContain('Inspect photo region');
});

it('renders returned deterministic calculations in the contextual portion calculator', () => {
  const observation: Observation = { id: 'carbohydrate-row', field: 'ocr-line', text: 'Carbohydrate 60 g per 100 g', side: 'back', confidence: 90, origin: 'ocr', imageId };
  const pkg = packageSchema.parse({ ...parseLabel('Package label', { origin: 'user' }), name: 'Unidentified package', observations: [observation], rawText: observation.text });
  const calculation: Calculation = {
    id: 'calc-carbohydrate-20g', label: 'Carbohydrate in 20 g', nutrient: 'carbohydrate', input: 60, inputUnit: 'g', basisAmount: 100,
    portion: 20, portionUnit: 'g', result: 12, unit: 'g', formula: '60 g × 20 g ÷ 100 g', observationIds: [observation.id],
    interpretationIds: ['row-carbohydrate'], assumptions: ['Image-linked provisional package interpretation.'],
  };
  const audit = { ...buildAudit(pkg, 30, 'g', defaultProfile, 'How much carbohydrate?'), calculations: [calculation] };
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    question="How much carbohydrate in 30 g?" components={[{ type: 'portion-calculator', observationIds: [], sourceIds: [], calculationIds: [calculation.id] }]}
    pkg={pkg} audit={audit} portion={30} portionUnit="g" onPortionChange={() => {}} onPortionUnitChange={() => {}}
    onSaveCorrection={() => true} canInspect={() => true} isInspecting={() => false} onInspect={() => {}}
    candidates={[]} interpretedReadings={[]} sources={[]} selectedProduct={null}
  />);

  expect(markup).toContain('Nutrition for this amount');
  expect(markup).toContain('For 30 g');
  expect(markup).toContain('18 g');
  expect(markup).toContain('unverified interpretation');
});

it('opens a declared-piece follow-up calculator at the amount used by its answer', () => {
  const observation: Observation = { id: 'bisk-carbohydrate', field: 'ocr-line', text: 'Carbohydrates 69.29 g per 100 g', side: 'back', confidence: 90, origin: 'ocr', imageId };
  const pkg = packageSchema.parse({
    ...parseLabel('Package label', { origin: 'user' }), name: 'Unidentified package', observations: [observation], rawText: observation.text,
    reconstruction: {
      identity: { brand: null, name: null, variant: null, status: 'unreadable', evidence: { observationIds: [], imageRegions: [] } },
      serving: { printedText: 'SERVING SIZE: 2 biscuits (approx. 13.4 g)', quantity: null, unit: null, pieceCount: null, pieceDescription: null, status: 'provisional', evidence: { observationIds: [observation.id], imageRegions: [] } },
      nutritionRows: [{ rowId: 'bisk-carbohydrate-per-100g', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '69.29 g', value: 69.29, unit: 'g', columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence: { observationIds: [observation.id], imageRegions: [] } }],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Provisional package interpretation.',
      revision: 1, updatedAt: '2026-10-24T00:00:00.000Z', model: 'fixture-model', current: true,
    },
  });
  const calculation: Calculation = {
    id: 'calc-bisk-serving-carb', label: 'Carbohydrate in 13.4 g', nutrient: 'carbohydrate', input: 69.29, inputUnit: 'g', basisAmount: 100,
    portion: 13.4, portionUnit: 'g', result: 9.28486, unit: 'g', formula: '69.29 g × 13.4 g ÷ 100 g',
    observationIds: [observation.id], interpretationIds: ['bisk-carbohydrate-per-100g'], assumptions: ['Provisional, unverified label interpretation.'],
  };
  const question = 'What about just two biscuits?';
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    question={question} components={[{ type: 'portion-calculator', observationIds: [observation.id], sourceIds: [], calculationIds: [calculation.id] }]}
    pkg={pkg} audit={{ ...buildAudit(pkg, 100, 'g', defaultProfile, question), calculations: [calculation] }} portion={13.4} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} candidates={[]}
    interpretedReadings={[]} sources={[]} selectedProduct={null}
  />);

  expect(markup).toContain('value="13.4"');
  expect(markup).toContain('For 13.4 g');
  expect(markup).toContain('9.28 g');
  expect(markup).toContain('Based on an unverified interpretation');
});

it('shows linked reconstructed rows in a compact contextual nutrition view instead of an empty parser table', () => {
  const observation: Observation = { id: 'nutrition-observation', field: 'ocr-line', text: 'Carbohydrates 69.29g; sugars 0.5g; per 100g', side: 'back', confidence: 74, origin: 'ocr', imageId };
  const pkg = packageSchema.parse({
    ...parseLabel('Package label', { origin: 'user' }),
    name: 'Unidentified package', nutrients: [], observations: [observation], rawText: observation.text,
    reconstruction: {
      identity: { brand: null, name: 'Example crackers', variant: null, status: 'provisional', evidence: { observationIds: ['nutrition-observation'], imageRegions: [] } },
      serving: null,
      nutritionRows: [
        { rowId: 'carbohydrate-per-100g', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '69.29g', value: 69.29, unit: 'g', columnLabel: 'Per 100g', basisText: 'per 100g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence: { observationIds: ['nutrition-observation'], imageRegions: [] } },
        { rowId: 'sugars-per-100g', nutrient: 'Total sugars', printedLabel: 'Total sugars', printedValue: '0.5g', value: 0.5, unit: 'g', columnLabel: 'Per 100g', basisText: 'per 100g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence: { observationIds: ['nutrition-observation'], imageRegions: [] } },
      ],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Provisional image interpretation.',
      revision: 1, updatedAt: '2026-10-23T00:00:00.000Z', model: 'fixture-model', current: true,
    },
  });
  let opened = false;
  const question = 'Can you show the nutrition table?';
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    question={question} components={[{ type: 'nutrition-table', observationIds: [observation.id], sourceIds: [], calculationIds: [] }]}
    pkg={pkg} audit={buildAudit(pkg, 30, 'g', defaultProfile, question)} portion={30} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} onOpenInspector={() => { opened = true; }}
    candidates={[]} interpretedReadings={[]} sources={[]} selectedProduct={null}
  />);

  expect(markup).toContain('Nutrition on the label');
  expect(markup).toContain('69.29 g');
  expect(markup).toContain('0.5 g');
  expect(markup).toContain('per 100 g');
  expect(markup).toContain('provisional · unverified');
  expect(markup).toContain('Review or edit package readings');
  expect(markup).not.toContain('Not established');
  expect(opened).toBe(false); // Rendering offers the action; it does not change inspector state.
});

it('shows a compact review action instead of an empty table when every reconstructed value is conflicted', () => {
  const observation: Observation = { id: 'contested-nutrition-line', field: 'ocr-line', text: 'Carbohydrates 69.29 g per 100 g', side: 'back', confidence: 74, origin: 'ocr', imageId };
  const pkg = packageSchema.parse({
    ...parseLabel('Package label', { origin: 'user' }),
    name: 'Unidentified package', nutrients: [], observations: [observation], rawText: observation.text,
    reconstruction: {
      identity: { brand: null, name: 'Example crackers', variant: null, status: 'provisional', evidence: { observationIds: [observation.id], imageRegions: [] } },
      serving: null,
      nutritionRows: [{ rowId: 'carbohydrate-contested', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: null, value: null, unit: null, columnLabel: 'Per 100 g', basisText: 'Per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'conflict', evidence: { observationIds: [observation.id], imageRegions: [] } }],
      ingredients: [], additives: [], statements: [], regions: [],
      unresolved: [{ field: 'nutrition.carbohydrate', reason: 'Saved reading: 69.29 g; recheck: 69.98 g. Both remain in history.', evidence: { observationIds: [observation.id], imageRegions: [] } }],
      interpretationNote: 'The disputed value is withheld.', revision: 2, updatedAt: '2026-10-24T00:00:00.000Z', model: 'local evidence merge r1+r2', current: true,
    },
  });
  let opened = false;
  const question = 'Show the nutrition table';
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    question={question} components={[{ type: 'nutrition-table', observationIds: [observation.id], sourceIds: [], calculationIds: [] }]}
    pkg={pkg} audit={buildAudit(pkg, 30, 'g', defaultProfile, question)} portion={30} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} onOpenInspector={() => { opened = true; }}
    candidates={[]} interpretedReadings={[]} sources={[]} selectedProduct={null}
  />);

  expect(markup).toContain('Nutrition readings need review');
  expect(markup).toContain('Carbohydrates');
  expect(markup).toContain('Withheld');
  expect(markup).toContain('Review both readings');
  expect(markup).not.toContain('69.29');
  expect(markup).not.toContain('69.98');
  expect(opened).toBe(false);
});

it('keeps a rejected recheck reviewable and exposes a deliberate way to select the active interpretation', () => {
  const reconstruction=packageReconstructionSchema.parse({
    identity:{brand:'Bisk Farm',name:'Sugar Free Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
    serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Saved package reading.',
    revision:4,updatedAt:'2026-10-23T00:00:00.000Z',model:'gemini-test',current:true,
  });
  const alternative=packageReconstructionSchema.parse({...reconstruction,revision:5,current:false,interpretationNote:'Conflicting recheck.'});
  const markup=renderToStaticMarkup(<PackageReconstructionView reconstruction={reconstruction} history={[alternative]} savedNutrients={[]} onCorrect={()=>true} onInspectEvidence={()=>true} onActivateRevision={()=>true}/>);
  expect(markup).toContain('1 earlier or alternative interpretation');
  expect(markup).toContain('Revision 5');
  expect(markup).toContain('Review');
  expect(markup).toContain('alternative');
});

it('shows printed pack contents and unit declarations separately from the serving',()=>{
  const evidence={observationIds:['pack-quantity-line'],imageRegions:[]};
  const reconstruction=packageReconstructionSchema.parse({
    identity:{brand:'Example',name:'Snack assortment',variant:null,status:'provisional',evidence},
    serving:{printedText:'Serving size 2 pieces (30 g)',quantity:30,unit:'g',pieceCount:2,pieceDescription:'pieces',status:'provisional',evidence},
    quantityDeclarations:[
      {kind:'net-content',printedText:'Net contents 300 g',quantity:300,unit:'g',status:'provisional',evidence},
      {kind:'unit-count',printedText:'10 individual packets',quantity:10,unit:'pieces',status:'provisional',evidence},
      {kind:'servings-per-package',printedText:'About 10 servings',quantity:10,unit:'servings',status:'provisional',evidence},
    ],
    nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Explicit package declarations.',
    revision:1,updatedAt:'2026-10-25T00:00:00.000Z',model:'fixture',current:true,
  });
  const markup=renderToStaticMarkup(<PackageReconstructionView reconstruction={reconstruction} savedNutrients={[]} onCorrect={()=>true} onInspectEvidence={()=>true}/>);
  expect(markup).toContain('2 pieces · about 30 g');
  expect(markup).toContain('Printed package quantities');
  expect(markup).toContain('Net contents');
  expect(markup).toContain('300 g');
  expect(markup).toContain('10 individual packets');
  expect(markup).toContain('About 10 servings');
  expect(markup).toContain('10 servings');
});

it('keeps raw package-evidence OCR out of the assistant conversation cards', () => {
  const observation: Observation = { id: 'raw-label-line', field: 'ocr-line', text: 'INGREDIENTS: wheat flour, edible oil, antioxidant (319)', side: 'back', confidence: 88, origin: 'ocr', imageId };
  const pkg = packageSchema.parse({ ...parseLabel('Package label', { origin: 'user' }), name: 'Unidentified package', observations: [observation], rawText: observation.text });
  const markup = renderToStaticMarkup(<ThreadGenerativeUI
    components={[
      { type: 'package-evidence', observationIds: [observation.id], sourceIds: [], calculationIds: [] },
      { type: 'package-details', observationIds: [observation.id], sourceIds: [], calculationIds: [] },
    ]}
    pkg={pkg} audit={buildAudit(pkg, 30, 'g', defaultProfile, 'Inspect this package')} portion={30} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} candidates={[]}
    interpretedReadings={[]} sources={[]} selectedProduct={null}
  />);

  // Raw OCR and photo inspection now live in the on-demand Evidence & tools
  // drawer; model-selected package-evidence cards must not append another
  // technical panel to every answer.
  expect(markup).toBe('');
});

it('renders only the trusted UI components selected for the assistant turn and keeps OCR detail collapsed', () => {
  const observation: Observation = { id: 'ingredient-line', field: 'ocr-line', text: 'INGREDIENTS: refined wheat flour (maida), edible vegetable oil', side: 'back', confidence: 90, origin: 'ocr', imageId };
  const pkg = packageSchema.parse({ ...parseLabel('Package label', { origin: 'user' }), name: 'Unidentified package', observations: [observation], rawText: observation.text });
  const candidate: TentativeStructuredCandidate = {
    candidateId: 'ingredient-reading-1', kind: 'ingredient', field: 'ingredient', proposedValue: 'Refined wheat flour (maida)', numericValue: null, unit: null, basis: null,
    normalizedEntity: 'refined wheat flour', status: 'tentative', observationIds: [observation.id], sourceIds: [],
    supportingSpans: [{ kind: 'observation', id: observation.id, quote: observation.text }], uncertainty: 'Possible package reading; check the original image.',
  };
  const render = (question: string) => renderToStaticMarkup(<ThreadGenerativeUI
    question={question} components={[{ type: 'ingredient-explorer', observationIds: [observation.id], sourceIds: [], calculationIds: [] }]}
    pkg={pkg} audit={buildAudit(pkg, 30, 'g', defaultProfile, question)} portion={30} portionUnit="g"
    onPortionChange={() => {}} onPortionUnitChange={() => {}} onSaveCorrection={() => true}
    canInspect={() => true} isInspecting={() => false} onInspect={() => {}} candidates={[candidate]}
    interpretedReadings={[]} sources={[]} selectedProduct={null}
  />);

  const suitabilityMarkup = render('Is this a good daily snack?');
  expect(suitabilityMarkup).toContain('Ingredient and additive readings');
  expect(suitabilityMarkup).toContain('Possible · unverified');
  expect(suitabilityMarkup).toContain('View supporting label text');
  // Question semantics are handled by the assistant/tool path. The renderer
  // consumes only the validated component instructions supplied for this turn;
  // it must not independently classify the question with keyword heuristics.
  expect(render('What is the package weight?')).toContain('Ingredient and additive readings');
  const markup = render('What ingredients are listed?');
  expect(markup).toContain('Refined wheat flour (maida)');
  expect(markup).toContain('Possible · unverified');
  expect(markup).toContain('View supporting label text');
  expect(markup).toContain('<details class="thread-ui-evidence-disclosure">');
});

it('renders recovered package ingredients from the saved reconstruction instead of requiring a parser candidate',()=>{
  const observation=makeObservation('reconstructed-ingredient-line','INGREDIENTS: REFINED WHEAT FLOUR (MAIDA) (89.98%)',['INGREDIENTS:','REFINED','WHEAT','FLOUR','(MAIDA)','(89.98%)'],[[20,120],[130,210],[220,290],[300,380],[390,470],[480,560]],100);
  const pkg=packageSchema.parse({
    ...parseLabel('Package label',{origin:'user'}),name:'Unidentified food package',observations:[observation],rawText:observation.text,
    ocrCaptures:[{runId,imageId,side:'back',sourceImage:{width:1000,height:1000},preparedImage:{width:1000,height:1000},bboxCoordinateSpace:'prepared-image-pixels',engine:{name:'fixture-reader',version:'1',language:'eng',confidenceScale:'0-100',segmentationMode:'single-block'},processing:{rotation:0,contrast:false,invert:false,cropPercent:null}}],
    reconstruction:{
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:[observation.id],imageRegions:[]}},
      serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'REFINED WHEAT FLOUR (MAIDA)',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:[observation.id],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional image reconstruction.',revision:1,updatedAt:'2026-10-24T00:00:00.000Z',model:'fixture-model',current:true,
    },
  });
  const question='Can you show the nutrition table and ingredient list?';
  const markup=renderToStaticMarkup(<ThreadGenerativeUI question={question} components={[{type:'ingredient-explorer',observationIds:[observation.id],sourceIds:[],calculationIds:[]}]}
    pkg={pkg} audit={buildAudit(pkg,30,'g',defaultProfile,question)} portion={30} portionUnit="g" onPortionChange={()=>{}} onPortionUnitChange={()=>{}}
    onSaveCorrection={()=>true} canInspect={()=>true} isInspecting={()=>false} onInspect={()=>{}} onOpenInspector={()=>{}} candidates={[]} interpretedReadings={[]} sources={[]} selectedProduct={null}/>);
  expect(markup).toContain('Ingredient and additive readings');
  expect(markup).toContain('refined wheat flour');
  expect(markup).toContain('89.98%');
  expect(markup).toContain('Gemini reading · unverified');
  expect(markup).toContain('View package details');
  expect(markup).not.toContain('Possible · unverified');
});

it('renders photo-linked reconstructed facts in the thread when OCR lines are absent',()=>{
  const photoId='photo-only-reconstruction';
  const region={imageId:photoId,region:{x:0.08,y:0.12,width:0.84,height:0.4}};
  const pkg=packageSchema.parse({
    ...parseLabel('Package label',{origin:'user'}),name:'Unidentified food package',observations:[],rawText:'',
    visionCaptures:[{runId:'vision-only-run',imageId:photoId,side:'back',sourceImage:{width:900,height:363},processing:{rotation:0,contrast:false,invert:false,crop:null},model:'fixture-model'}],
    reconstruction:{
      identity:{brand:'Example',name:'Crackers',variant:'Sugar Free',status:'provisional',evidence:{observationIds:[],imageRegions:[region]}},
      serving:{printedText:'2 biscuits (13.4 g)',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:[],imageRegions:[region]}},
      nutritionRows:[
        {rowId:'carbohydrate-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[region]}},
        {rowId:'protein-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'11.42 g',value:11.42,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[region]}},
      ],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'Refined wheat flour (maida)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:[],imageRegions:[region]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional image interpretation.',
      revision:1,updatedAt:'2026-10-24T00:00:00.000Z',model:'fixture-model',current:true,
    },
  });
  const question='Can you show the nutrition table and ingredient list?';
  const markup=renderToStaticMarkup(<ThreadGenerativeUI question={question} components={[
    {type:'nutrition-table',observationIds:[],sourceIds:[],calculationIds:[]},
    {type:'ingredient-explorer',observationIds:[],sourceIds:[],calculationIds:[]},
  ]} pkg={pkg} audit={buildAudit(pkg,30,'g',defaultProfile,question)} portion={30} portionUnit="g"
    onPortionChange={()=>{}} onPortionUnitChange={()=>{}} onSaveCorrection={()=>true}
    canInspect={()=>false} isInspecting={()=>false} onInspect={()=>{}} candidates={[]}
    interpretedReadings={[]} sources={[]} selectedProduct={null}/>);

  expect(markup).toContain('Nutrition on the label');
  expect(markup).toContain('69.29 g');
  expect(markup).toContain('11.42 g');
  expect(markup).toContain('refined wheat flour');
  expect(markup).toContain('89.98%');
  expect(markup).toContain('Gemini reading · unverified');
});
