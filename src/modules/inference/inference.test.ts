import { describe, expect, it } from 'vitest';
import { defaultProfile, packageSchema, tentativeStructuredCandidateSchema, type Calculation, type PackageData } from '../../lib/contracts';
import { reconcileInterpretedNutrition } from '../../lib/interpreted-nutrients';
import { packageForAssist } from './evidence';
import { InferenceModuleError, validateInferenceOutput } from './index';

const fixturePackage: PackageData = packageSchema.parse({
  id: 'synthetic-package',
  name: 'Unidentified package',
  ingredients: [],
  additives: [],
  allergens: [],
  claims: [],
  nutrients: [],
  observations: [{
    id: 'ocr-line-1',
    field: 'ocr-line',
    text: 'Protein approx 8.8 g',
    side: 'back',
    confidence: 54,
    bbox: { x0: 12, y0: 20, x1: 250, y1: 42 },
    ocrWords: [
      { wordIndex: 0, text: 'Protein', confidence: 92, bbox: { x0: 12, y0: 20, x1: 92, y1: 42 } },
      { wordIndex: 1, text: 'approx', confidence: 43, bbox: { x0: 98, y0: 20, x1: 153, y1: 42 } },
      { wordIndex: 2, text: '8.8', confidence: 49, bbox: { x0: 159, y0: 20, x1: 198, y1: 42 } },
      { wordIndex: 3, text: 'g', confidence: 70, bbox: { x0: 205, y0: 20, x1: 217, y1: 42 } },
    ],
    origin: 'ocr',
    imageId: 'synthetic-image',
    readingOrder: { runId: 'synthetic-run', blockIndex: 0, paragraphIndex: 0, lineIndex: 0 },
  }],
  ocrCaptures: [{
    runId: 'synthetic-run',
    imageId: 'synthetic-image',
    side: 'back',
    sourceImage: { width: 300, height: 500 },
    preparedImage: { width: 300, height: 500 },
    bboxCoordinateSpace: 'prepared-image-pixels',
    engine: { name: 'fixture-reader', version: '1', language: 'eng', confidenceScale: '0-100', segmentationMode: 'single-block' },
    processing: { rotation: 0, contrast: false, invert: false, cropPercent: null },
  }],
  rawText: 'Protein approx 8.8 g',
  warnings: [],
  synthetic: true,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const observationSpan = { kind: 'observation' as const, id: 'ocr-line-1', quote: 'Protein approx 8.8 g' };

describe('provider-independent inference output validation', () => {
  it('compacts follow-up package context without breaking saved reconstruction lineage', () => {
    const pkg=packageSchema.parse({
      ...fixturePackage,
      observations:[...fixturePackage.observations,{id:'noise-line',field:'ocr-line',text:'Unrelated front-panel text',side:'front',confidence:72,origin:'ocr',imageId:'synthetic-image'}],
      rawText:'Protein approx 8.8 g\nUnrelated front-panel text',
      reconstruction:{
        identity:{brand:null,name:'Example crackers',variant:null,status:'provisional',evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},
        serving:{printedText:'30 g',quantity:30,unit:'g',pieceCount:null,pieceDescription:null,status:'provisional',evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},
        nutritionRows:[{rowId:'protein-per-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'8.8 g',value:8.8,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['ocr-line-1'],imageRegions:[]}}],
        ingredients:[],additives:[],statements:[],
        regions:[{imageId:'synthetic-image',role:'nutrition-table',region:{x:0,y:0,width:1,height:1},observationIds:['ocr-line-1']}],
        unresolved:[],interpretationNote:'A provisional label reconstruction.',revision:1,updatedAt:'2026-10-23T00:00:00.000Z',model:'fixture-model',current:true,
      },
    });
    const compact=packageForAssist(pkg);
    expect(packageSchema.safeParse(compact).success).toBe(true);
    expect(compact.rawText).toBe('');
    expect(compact.observations.map(item=>item.id)).toEqual(['ocr-line-1']);
    expect(compact.observations[0].ocrWords).toBeUndefined();
    expect(compact.observations[0].readingOrder).toEqual({runId:'synthetic-run',blockIndex:0,paragraphIndex:0,lineIndex:0});
    expect(compact.reconstruction?.nutritionRows[0].value).toBe(8.8);
    expect(compact.ocrCaptures?.map(capture=>capture.imageId)).toEqual(['synthetic-image']);
  });

  it('accepts a natural answer linked to an exact provisional reconstruction row without OCR quotation', () => {
    const reconstruction={
      identity:{brand:null,name:'Example crackers',variant:null,status:'provisional' as const,evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},
      serving:null,
      nutritionRows:[{rowId:'protein-per-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'8.8 g',value:8.8,unit:'g',columnLabel:'Per 100 g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['ocr-line-1'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional model interpretation.',
    };
    const answer='The photographed table appears to list 8.8 g of protein per 100 g; this is a provisional visual reading.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],interpretationRowIds:['protein-per-100g']}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:fixturePackage});
    expect(result.answer).toBe(answer);
    expect(result.claims[0].interpretationRowIds).toEqual(['protein-per-100g']);
    expect(result.claims[0].supportingSpans).toEqual([]);
  });

  it('links a rounded nutrient claim to one uniquely matching deterministic calculation',()=>{
    const reconstruction={
      identity:{brand:'Example',name:'Crackers',variant:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      serving:{printedText:'2 biscuits (13.4 g)',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      nutritionRows:[{rowId:'carbohydrate-per-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional image-linked interpretation.',
    };
    const calculation:Calculation={
      id:'carbohydrate-two-biscuits',label:'Carbohydrate in 2 biscuits',nutrient:'carbohydrate',input:69.29,inputUnit:'g',basisAmount:100,
      portion:13.4,portionUnit:'g',result:9.28,unit:'g',formula:'69.29 g × 13.4 g ÷ 100 g',
      evidenceText:'Carbohydrates in 2 biscuits; 69.29 g per 100 g × 13.4 g ÷ 100 g = 9.28 g; provisional image-linked calculation.',
      observationIds:[],imageIds:['synthetic-image'],interpretationIds:['carbohydrate-per-100g'],assumptions:['Unverified package interpretation.'],
    };
    const answer='Two biscuits provide approximately 9.3 g of carbohydrates.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[]}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage,images:[{handle:'synthetic-image'}],calculations:[calculation]});
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].calculationIds).toEqual([calculation.id]);
    expect(result.claims[0].packageFactIds).toContain('package-fact:serving');
    expect(result.answer).toBe(answer);

    const ambiguous=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[]}],limitations:[],inspectImage:null,
    },{package:fixturePackage,images:[{handle:'synthetic-image'}],calculations:[calculation,{...calculation,id:'same-result-other-portion',portion:25,label:'Carbohydrate in 25 g'}]});
    expect(ambiguous.claims).toEqual([]);
    expect(ambiguous.answer).toContain('can’t establish a reliable answer');

    const wrongValue=validateInferenceOutput({
      answer:'Two biscuits provide 9.5 g of carbohydrates.',packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:'Two biscuits provide 9.5 g of carbohydrates.',observationIds:[],sourceIds:[]}],limitations:[],inspectImage:null,
    },{package:fixturePackage,images:[{handle:'synthetic-image'}],calculations:[calculation]});
    expect(wrongValue.claims).toEqual([]);
    expect(wrongValue.answer).not.toContain('9.5 g');
  });

  it('validates a serving-mass paraphrase against the linked reconstructed nutrition row and serving declaration', () => {
    const reconstruction = {
      identity: { brand: 'Bisk Farm', name: 'Cream Cracker', variant: 'Sugar Free', status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [{ imageId: 'synthetic-image', region: null }] } },
      serving: { printedText: '2 biscuits (approximately 13.4 g)', quantity: 13.4, unit: 'g' as const, pieceCount: 2, pieceDescription: 'biscuits', status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [{ imageId: 'synthetic-image', region: null }] } },
      nutritionRows: [{ rowId: 'carbohydrates-per-serving', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '9.28 g', value: 9.28, unit: 'g' as const, columnLabel: 'Per serving', basisText: 'per serving', basisAmount: 13.4, basisUnit: 'g' as const, qualifier: null, status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [{ imageId: 'synthetic-image', region: null }] } }],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Provisional visual reconstruction.',
    };
    const answer = 'For the printed serving of 2 biscuits (approx. 13.4 g), the provisional table reading is 9.28 g of carbohydrates per 13.4 g.';
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstruction,
      claims: [{ mode: 'synthesis', text: 'The table appears to list 9.28 g of carbohydrates per serving.', observationIds: [], sourceIds: [], interpretationRowIds: ['carbohydrates-per-serving'], packageFactIds: ['package-fact:serving'] }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, diagnostic: event => events.push(event) });

    expect(result.claims).toHaveLength(1);
    expect(events).toContainEqual({ stage: 'natural-answer', index: 0, decision: 'accepted' });
    expect(result.answer).toBe(answer);
  });

  it('keeps a complete serving sentence when a following unsupported quantity is discarded',()=>{
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable' as const,evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'2 biscuits (approx. 13.4 g)',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional package reading.',
    };
    const answer='Two biscuits represent the printed serving (approx. 13.4 g). The table provides 9.28 g of carbohydrates per serving.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:'The printed serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage});

    expect(result.answer).toBe('Two biscuits represent the printed serving (approx. 13.4 g).');
  });

  it('does not leave a dangling serving sentence when a later numeric sentence is withheld',()=>{
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable' as const,evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'2 biscuits (approx. 13.4 g)',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional package reading.',
    };
    const answer='Two biscuits represent the printed serving (approx. 13.4 g). The table provides 9.28 g of carbohydrates per serving.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:'The printed serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage});

    expect(result.answer).toBe('Two biscuits represent the printed serving (approx. 13.4 g).');
  });

  it('accepts an exact printed per-serving row when its numeric serving mass is unreadable, without converting it',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Sugar Free Cream Cracker',variant:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      serving:{printedText:'2 biscuits (approximately 13.4 g)',quantity:null,unit:null,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      nutritionRows:[{rowId:'carbohydrate-per-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g' as const,columnLabel:'Quantity per serving',basisText:'SERVING',basisAmount:null,basisUnit:null,qualifier:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Photo-linked provisional interpretation.',
    };
    const answer='The provisional table reading is 9.28 g of carbohydrates per serving; the package appears to define that serving as two biscuits, while its serving mass remains partly unreadable.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:'The photo-backed table appears to list 9.28 g of carbohydrates per serving.',observationIds:[],sourceIds:[]}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:fixturePackage});
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].interpretationRowIds).toEqual(['carbohydrate-per-serving']);
    expect(result.answer).toBe(answer);

    const noPrintedBasis={...reconstruction,nutritionRows:[{...reconstruction.nutritionRows[0],rowId:'basis-missing',columnLabel:null,basisText:null}]};
    const unsupported=validateInferenceOutput({
      answer:'The label shows 9.28 g of carbohydrates per serving.',packageReconstruction:noPrintedBasis,
      claims:[{mode:'synthesis',text:'The label shows 9.28 g of carbohydrates per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['basis-missing']}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage});
    expect(unsupported.claims).toEqual([]);
  });

  it('restores an omitted nutrition citation only for an exact traceable value, unit and printed basis',()=>{
    const reconstruction={
      identity:{brand:null,name:'Example crackers',variant:null,status:'provisional' as const,evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},
      serving:null,
      nutritionRows:[{rowId:'protein-per-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'8.8 g',value:8.8,unit:'g' as const,columnLabel:'Per 100 g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['ocr-line-1'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Photo-linked provisional interpretation.',
    };
    const answer='The photographed table appears to list 8.8 g of protein per 100 g; this remains a provisional reading.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[]}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage});

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].interpretationRowIds).toEqual(['protein-per-100g']);
    expect(result.answer).toBe(answer);
  });

  it('does not restore a nutrition citation when the generated amount differs from the traceable row',()=>{
    const reconstruction={
      identity:{brand:null,name:'Example crackers',variant:null,status:'provisional' as const,evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},
      serving:null,
      nutritionRows:[{rowId:'protein-per-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'8.8 g',value:8.8,unit:'g' as const,columnLabel:'Per 100 g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['ocr-line-1'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Photo-linked provisional interpretation.',
    };
    const answer='The photographed table appears to list 9 g of protein per 100 g.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[]}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage});

    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('9 g of protein');
  });

  it('restores ingredient, identity and serving citations from exact package reconstruction text',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      serving:{printedText:'2 biscuits approximately 13.4 g',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
      nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Photo-linked provisional interpretation.',
    };
    const answer='Bisk Farm Cream Cracker appears to list refined wheat flour first. One serving is two biscuits weighing 13.4 g.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[
        {mode:'synthesis',text:'Bisk Farm Cream Cracker appears to list refined wheat flour first.',observationIds:[],sourceIds:[]},
        {mode:'synthesis',text:'One serving is two biscuits weighing 13.4 g.',observationIds:[],sourceIds:[]},
      ],
      limitations:[],inspectImage:null,
    },{package:fixturePackage});

    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].packageFactIds).toEqual(['package-fact:identity','package-fact:ingredient:0']);
    expect(result.claims[1].packageFactIds).toEqual(['package-fact:serving']);
    expect(result.answer).toBe(answer);
  });

  it('accepts a reconstructed ingredient as provisional package evidence without requiring a parser observation',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}] }},
      serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Photo-backed provisional reconstruction.',
    };
    const answer='The package appears to list refined wheat flour first; this is a provisional visual interpretation.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:fixturePackage});

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].packageFactIds).toEqual(['package-fact:ingredient:0']);
    expect(result.answer).toBe(answer);
  });

  it('accepts provisional package facts linked to a photo attached in the current request',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'current-photo',region:null}] }},
      serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'current-photo',region:null}]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A provisional interpretation from the attached photo.',
    };
    const answer='The attached package photo appears to identify a Bisk Farm Cream Cracker and list refined wheat flour.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],packageFactIds:['package-fact:identity','package-fact:ingredient:0']}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:packageSchema.parse({...fixturePackage,observations:[],ocrCaptures:[],visionCaptures:[]}),images:[{handle:'current-photo'}]});

    expect(result.claims[0].packageFactIds).toEqual(['package-fact:identity','package-fact:ingredient:0']);
    expect(result.answer).toBe(answer);
  });

  it('rejects package facts that have no retained observation or photo lineage',()=>{
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR',printedPercentage:null,normalizedName:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Unlinked candidate.',
    };
    const answer='The package lists refined wheat flour.';
    const events:{stage:string;index:number;decision:string;reason?:string}[]=[];
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:fixturePackage,diagnostic:event=>events.push(event)});

    expect(result.claims).toEqual([]);
    expect(events).toContainEqual({stage:'claim',index:0,decision:'rejected',reason:'unknown-evidence-id'});
  });

  it('links a numeric claim to one exact reconstruction row only when nutrient, value, unit, basis and OCR lineage agree', () => {
    const observation = { id: 'ocr-carbs', field: 'ocr-line', text: 'Carbohydrates 69.29 g', side: 'back' as const, confidence: 72, origin: 'ocr' as const, imageId: 'synthetic-image' };
    const packageData = packageSchema.parse({ ...fixturePackage, observations: [...fixturePackage.observations, observation], rawText: `${fixturePackage.rawText}\n${observation.text}` });
    const reconstruction = {
      identity: { brand: null, name: 'Example crackers', variant: null, status: 'provisional' as const, evidence: { observationIds: ['ocr-carbs'], imageRegions: [] } },
      serving: null,
      nutritionRows: [{ rowId: 'carbs-per-100g', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '69.29 g', value: 69.29, unit: 'g', columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g' as const, qualifier: null, status: 'provisional' as const, evidence: { observationIds: ['ocr-carbs'], imageRegions: [] } }],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Provisional visual reconstruction.',
    };
    const text = 'The reconstructed label appears to list 69.29 g of carbohydrates per 100 g.';
    const output = { answer: text, packageReconstruction: reconstruction, claims: [{ mode: 'synthesis' as const, text, observationIds: ['ocr-carbs'], sourceIds: [] }], answerParts: [{ text, claimIndexes: [0] }], limitations: [], inspectImage: null };
    const result = validateInferenceOutput(output, { package: packageData });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].interpretationRowIds).toEqual(['carbs-per-100g']);
    expect(result.answer).toBe(text);
  });

  it('accepts the printed per-serving basis for an image-linked provisional row',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:{x:0.08,y:0.06,width:0.42,height:0.35}}]}},
      serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:{x:0.08,y:0.06,width:0.42,height:0.35}}]}},
      nutritionRows:[{rowId:'carbs-per-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Quantity per serving',basisText:'Per serving',basisAmount:13.4,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:{x:0.08,y:0.06,width:0.42,height:0.35}}]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Image-linked provisional reconstruction.',
    };
    const answer='The photographed table appears to list 9.28 g of carbohydrates per serving; the value remains provisional.';
    const events:{stage:string;index:number;decision:string;reason?:string}[]=[];
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],interpretationRowIds:['carbs-per-serving']}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:fixturePackage,diagnostic:event=>events.push(event)});

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toBe(answer);
    expect(events).not.toContainEqual({stage:'claim',index:0,decision:'rejected',reason:'unsupported-basis'});
  });

  it('validates a cited reconstruction row even when its supporting OCR excerpt omits the table basis',()=>{
    const observation={id:'ocr-carbs',field:'ocr-line',text:'Carbohydrates 69.29 g',side:'back' as const,confidence:72,origin:'ocr' as const,imageId:'synthetic-image'};
    const packageData=packageSchema.parse({...fixturePackage,observations:[...fixturePackage.observations,observation],rawText:`${fixturePackage.rawText}\n${observation.text}`});
    const reconstruction={
      identity:{brand:null,name:'Example crackers',variant:null,status:'provisional' as const,evidence:{observationIds:['ocr-carbs'],imageRegions:[]}},
      serving:null,
      nutritionRows:[{rowId:'carbs-per-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g' as const,columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['ocr-carbs'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional visual table reconstruction.',
    };
    const answer='The table appears to list 69.29 g of carbohydrates per 100 g; this reading is provisional.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:['ocr-carbs'],sourceIds:[],interpretationRowIds:['carbs-per-100g'],supportingSpans:[{kind:'observation',id:'ocr-carbs',quote:'Carbohydrates 69.29 g'}]}],
      limitations:[],inspectImage:null,
    },{package:packageData});
    expect(result.claims).toHaveLength(1);
    expect(result.answer).toBe(answer);

    const wrongBasis='The table appears to list 69.29 g of carbohydrates per serving.';
    const rejected=validateInferenceOutput({
      answer:wrongBasis,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:wrongBasis,observationIds:['ocr-carbs'],sourceIds:[],interpretationRowIds:['carbs-per-100g'],supportingSpans:[{kind:'observation',id:'ocr-carbs',quote:'Carbohydrates 69.29 g'}]}],
      limitations:[],inspectImage:null,
    },{package:packageData});
    expect(rejected.claims).toEqual([]);
    expect(rejected.answer).not.toContain(wrongBasis);
  });

  it('uses image-linked package facts as package evidence when a sourced food-choice judgment is requested',()=>{
    const source={id:'diabetes-guidance',title:'Food and carbohydrate guidance',publisher:'Public health source',url:'https://example.org/guidance',category:'guideline' as const,jurisdiction:'Global',publishedAt:'2026-01-01',effectiveAt:null,retrievedAt:'2026-01-02',summary:'Carbohydrate portions should be individualized as part of diabetes care.',limitations:'General guidance; not an individual target or product-specific clinical advice.'};
    const reconstruction={
      identity:{brand:null,name:null,variant:null,status:'unreadable' as const,evidence:{observationIds:[],imageRegions:[]}},serving:null,nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour (maida)',printedText:'REFINED WHEAT FLOUR (MAIDA)',printedPercentage:null,normalizedName:'refined wheat flour',status:'provisional' as const,evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}}],
      additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Image-linked provisional ingredient reconstruction.',
    };
    const answer='This is not a great daily snack default because the package lists refined wheat flour first; the guidance emphasizes individualized carbohydrate portions.';
    const result=validateInferenceOutput({
      answer,packageReconstruction:reconstruction,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[source.id],packageFactIds:['package-fact:ingredient:0'],supportingSpans:[{kind:'source',id:source.id,quote:source.summary}]}],
      limitations:[],inspectImage:null,
    },{package:fixturePackage,question:'Is this good to have for diabetic patients daily for snacking?',evidence:[source]});
    expect(result.claims).toHaveLength(1);
    expect(result.answer).toBe(answer);
  });

  it('accepts a derived declared-serving calculation as evidence for natural per-serving wording',()=>{
    const observation={id:'serving-and-carbs',field:'label-note',text:'Serving size 2 biscuits approximately 13.4 g; carbohydrates 69.29 g per 100 g.',side:'back' as const,confidence:78,origin:'user' as const};
    const packageData=packageSchema.parse({...fixturePackage,observations:[...fixturePackage.observations,observation],rawText:`${fixturePackage.rawText}\n${observation.text}`});
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional' as const,evidence:{observationIds:['serving-and-carbs'],imageRegions:[]}},
      serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g' as const,pieceCount:2,pieceDescription:'biscuits',status:'provisional' as const,evidence:{observationIds:['serving-and-carbs'],imageRegions:[]}},
      nutritionRows:[{rowId:'carbs-per-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const,qualifier:null,status:'provisional' as const,evidence:{observationIds:['serving-and-carbs'],imageRegions:[]}}],
      ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional visual reconstruction.',
    };
    const calculation={id:'carbs-declared-serving',label:'carbohydrate per serving (2 biscuits, approximately 13.4 g)',nutrient:'carbohydrate' as const,input:69.29,inputUnit:'g',basisAmount:100,portion:13.4,portionUnit:'g' as const,result:69.29*13.4/100,unit:'g',formula:'69.29 g × 13.4 g ÷ 100 g',observationIds:['serving-and-carbs'],interpretationIds:['carbs-per-100g'],assumptions:['The source row remains provisional.']};
    const answer='For 2 biscuits (about 13.4 g), the provisional calculation is approximately 9.28 g carbohydrate per serving.';
    const result=validateInferenceOutput({answer,packageReconstruction:reconstruction,claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],calculationIds:[calculation.id],packageFactIds:['package-fact:serving']}],answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null},{package:packageData,calculations:[calculation]});

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toBe(answer);
  });

  it('does not attach an adjacent reconstructed row when the claimed nutrient or printed basis differs', () => {
    const observation = { id: 'ocr-carbs', field: 'ocr-line', text: 'Carbohydrates 69.29 g', side: 'back' as const, confidence: 72, origin: 'ocr' as const, imageId: 'synthetic-image' };
    const packageData = packageSchema.parse({ ...fixturePackage, observations: [...fixturePackage.observations, observation], rawText: `${fixturePackage.rawText}\n${observation.text}` });
    const reconstruction = {
      identity: { brand: null, name: null, variant: null, status: 'provisional' as const, evidence: { observationIds: ['ocr-carbs'], imageRegions: [] } },
      serving: null,
      nutritionRows: [{ rowId: 'carbs-per-100g', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '69.29 g', value: 69.29, unit: 'g', columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g' as const, qualifier: null, status: 'provisional' as const, evidence: { observationIds: ['ocr-carbs'], imageRegions: [] } }],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Provisional visual reconstruction.',
    };
    const wrongNutrient = 'Protein is 69.29 g per 100 g.';
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer: wrongNutrient,
      packageReconstruction: reconstruction,
      claims: [{ mode: 'synthesis', text: wrongNutrient, observationIds: ['ocr-carbs'], sourceIds: [] }],
      answerParts: [{ text: wrongNutrient, claimIndexes: [0] }], limitations: [], inspectImage: null,
    }, { package: packageData, diagnostic: event => events.push(event) });
    const wrongBasis = 'Carbohydrates are 69.29 g per serving.';
    const basisResult = validateInferenceOutput({
      answer: wrongBasis,
      packageReconstruction: reconstruction,
      claims: [{ mode: 'synthesis', text: wrongBasis, observationIds: ['ocr-carbs'], sourceIds: [] }],
      answerParts: [{ text: wrongBasis, claimIndexes: [0] }], limitations: [], inspectImage: null,
    }, { package: packageData, diagnostic: event => events.push(event) });

    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain(wrongNutrient);
    expect(events).toContainEqual({ stage: 'claim', index: 0, decision: 'rejected', reason: 'unsupported-nutrient-association' });
    expect(basisResult.claims).toEqual([]);
    expect(events).toContainEqual({ stage: 'claim', index: 0, decision: 'rejected', reason: 'unsupported-basis' });
  });

  it('uses a saved photo region as reconstruction lineage on follow-up without reattaching image bytes',()=>{
    const pkg=packageSchema.parse({
      ...fixturePackage,
      reconstruction:{
        identity:{brand:null,name:'Example crackers',variant:null,status:'provisional',evidence:{observationIds:['ocr-line-1'],imageRegions:[]}},
        serving:null,
        nutritionRows:[{rowId:'carbohydrate-per-100g',nutrient:'Carbohydrate',printedLabel:'Carbohydrate',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:{x:0.1,y:0.2,width:0.3,height:0.2}}]}}],
        ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'A saved, provisional photo interpretation.',revision:1,updatedAt:'2026-10-23T00:00:00.000Z',model:'fixture-model',current:true,
      },
    });
    const answer='The saved table interpretation lists 69.29 g of carbohydrate per 100 g; it remains provisional.';
    const result=validateInferenceOutput({
      answer,
      claims:[{mode:'synthesis',text:answer,observationIds:[],sourceIds:[],interpretationRowIds:['carbohydrate-per-100g']}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:pkg});

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toBe(answer);
  });

  it('supports source-linked allergen, warning and package-claim candidate kinds', () => {
    const base = { candidateId: 'label-candidate', field: 'label-content', proposedValue: 'Contains wheat', numericValue: null, unit: null, basis: null, normalizedEntity: null, status: 'tentative' as const, observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [{ kind: 'observation' as const, id: 'ocr-line-1', quote: 'Protein approx 8.8 g' }], uncertainty: 'Preserved as an unverified example.' };
    for (const kind of ['allergen', 'warning', 'package-claim'] as const) expect(tentativeStructuredCandidateSchema.safeParse({ ...base, kind }).success).toBe(true);
  });

  it('uses conversational answer text when it links accepted claims and preserves supported numbers', () => {
    const output = {
      answer: 'The label appears to show about 8.8 g of protein, but the serving basis is not established.',
      claims: [{
        mode: 'synthesis',
        text: 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.',
        observationIds: ['ocr-line-1'],
        sourceIds: [],
        supportingSpans: [observationSpan],
      }],
      answerParts: [{ text: 'The label may show about 8.8 g of protein, but I cannot tell what amount that applies to.', claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    };

    const result = validateInferenceOutput(output, { package: fixturePackage });

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toBe(output.answer);
    expect(result.answer).not.toContain('Evidence-linked interpretation');
    expect(result.answer).not.toContain('[observation:');
  });

  it('accepts a natural answer when independently validated claims support its numbers and no answer-part links are supplied', () => {
    const answer = 'The label appears to show about 8.8 g of protein, but its serving basis is unresolved.';
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer,
      claims: [{
        mode: 'synthesis', text: 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.',
        observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [observationSpan],
      }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage, diagnostic: event => events.push(event) });

    expect(result.answer).toBe(answer);
    expect(result.claims).toHaveLength(1);
    expect(events).toContainEqual({ stage: 'natural-answer', index: 0, decision: 'accepted' });
  });

  it('rejects unsupported quantities in natural prose while preserving supported claims', () => {
    const result = validateInferenceOutput({
      answer: 'The label shows 9 g of protein per serving.',
      claims: [{
        mode: 'synthesis', text: 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.',
        observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [observationSpan],
      }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toHaveLength(1);
    expect(result.answer).toContain('could not safely assemble it into a clear answer');
    expect(result.answer).not.toContain('9 g');
    expect(result.answer).not.toContain('8.8 g');
  });

  it('keeps valid answer parts when a sibling part cites a claim that did not survive validation', () => {
    const supportedAnswer = 'The label may show about 8.8 g of protein, but its serving basis is unresolved.';
    const result = validateInferenceOutput({
      answer: 'This is a healthy daily snack.',
      claims: [{
        mode: 'synthesis', text: 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.',
        observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [observationSpan],
      }],
      answerParts: [
        { text: supportedAnswer, claimIndexes: [0] },
        { text: 'Unsupported extra sentence.', claimIndexes: [7] },
      ],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage });

    expect(result.answer).toBe(supportedAnswer);
    expect(result.answer).not.toContain('Unsupported extra sentence');
    expect(result.answer).not.toContain('Some details are interpreted');
  });

  it('retains a valid claim but does not substitute a claim record for a rejected conversational answer', () => {
    const result = validateInferenceOutput({
      answer: 'The label shows 9 g of protein per serving.',
      claims: [{
        mode: 'synthesis', text: 'The OCR line appears to show 8.8 g of protein, but the basis is unresolved.',
        observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [observationSpan],
      }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims[0].text).toContain('8.8 g of protein');
    expect(result.answer).toContain('could not safely assemble it into a clear answer');
    expect(result.answer).not.toContain('8.8 g of protein');
    expect(result.answer).not.toContain('9 g');
  });

  it('does not use an unsafe natural answer even when nearby package claims are supported', () => {
    const result = validateInferenceOutput({
      answer: 'You should eat these biscuits every day to manage diabetes.',
      claims: [{
        mode: 'synthesis', text: 'The label appears to show 8.8 g of protein, but the basis is unresolved.',
        observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [observationSpan],
      }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims[0].text).toContain('8.8 g of protein');
    expect(result.answer).toContain('could not safely assemble it into a clear answer');
    expect(result.answer).not.toContain('8.8 g of protein');
    expect(result.answer).not.toMatch(/eat these biscuits every day/i);
  });

  it('accepts a qualified product judgment grounded by package facts and a relevant source without requiring the source to repeat the judgment adjective', () => {
    const observation = {
      id: 'package-label', field: 'ocr-line',
      text: 'Carbohydrates 69.29 g per 100 g. Refined wheat flour 89.98%.',
      side: 'back' as const, confidence: 78, origin: 'ocr' as const, imageId: 'synthetic-image',
    };
    const packageData = packageSchema.parse({
      ...fixturePackage,
      observations: [...fixturePackage.observations, observation],
      rawText: `${fixturePackage.rawText}\n${observation.text}`,
    });
    const guidance = {
      id: 'global-diabetes-food-guidance', title: 'Food choices and glucose', publisher: 'International diabetes education',
      url: 'https://example.org/diabetes-food-guidance', category: 'guideline' as const, jurisdiction: 'Global',
      publishedAt: '2026-01-01', effectiveAt: null, retrievedAt: '2026-01-02',
      summary: 'International diabetes education notes carbohydrate choices affect glucose and refined carbohydrates may raise it more quickly than higher-fibre choices.',
      limitations: 'General education, not a personal target or a conclusion about this specific product.',
    };
    const answer = 'Given the label’s 69.29 g of carbohydrates per 100 g and 89.98% refined wheat flour, this may not be an ideal everyday snack for someone managing diabetes. International diabetes education notes refined carbohydrates can raise glucose more quickly; the package readings remain provisional.';
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer,
      claims: [
        { mode: 'synthesis', text: 'The package observation lists 69.29 g of carbohydrates per 100 g and refined wheat flour at 89.98%.', observationIds: ['package-label'], sourceIds: [] },
        { mode: 'synthesis', text: guidance.summary, observationIds: [], sourceIds: [guidance.id], supportingSpans: [{ kind: 'source', id: guidance.id, quote: guidance.summary }] },
      ],
      answerParts: [{ text: answer, claimIndexes: [0, 1] }],
      limitations: [], inspectImage: null,
    }, { package: packageData, evidence: [guidance], diagnostic: event => events.push(event) });

    expect(result.answer).toBe(answer);
    expect(result.claims).toHaveLength(2);
    expect(events).toContainEqual({ stage: 'natural-answer', index: 0, decision: 'accepted' });
    expect(events).toContainEqual({ stage: 'answer-part', index: 0, decision: 'accepted' });
  });

  it('does not treat general comparative guidance as package-specific without a linked package fact',()=>{
    const guidance={
      id:'global-diabetes-food-guidance',title:'Food choices and glucose',publisher:'International diabetes education',
      url:'https://example.org/diabetes-food-guidance',category:'guideline' as const,jurisdiction:'Global',
      publishedAt:'2026-01-01',effectiveAt:null,retrievedAt:'2026-01-02',
      summary:'Refined carbohydrates may raise blood glucose more quickly than higher-fibre choices.',
      limitations:'General education, not a conclusion about this specific product.',
    };
    const answer='Refined carbohydrates may make this a poor everyday snack for someone managing diabetes.';
    const events:{stage:string;index:number;decision:string;reason?:string}[]=[];
    const result=validateInferenceOutput({
      answer,
      claims:[{mode:'synthesis',text:guidance.summary,observationIds:[],sourceIds:[guidance.id],supportingSpans:[{kind:'source',id:guidance.id,quote:guidance.summary}]}],
      answerParts:[{text:answer,claimIndexes:[0]}],limitations:[],inspectImage:null,
    },{package:fixturePackage,evidence:[guidance],diagnostic:event=>events.push(event)});

    expect(result.answer).not.toBe(answer);
    expect(events).toContainEqual({stage:'natural-answer',index:1,decision:'rejected',reason:'comparative-judgment-needs-reference'});
  });

  it('keeps a cautious suitability answer when it states that the evidence is insufficient', () => {
    const cautiousAnswer = 'The package evidence does not provide enough information to establish whether this is suitable for daily snacking.';
    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.',
        observationIds: ['ocr-line-1'],
        sourceIds: [],
        supportingSpans: [observationSpan],
      }],
      answerParts: [{ text: cautiousAnswer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.answer).toBe(cautiousAnswer);
  });

  it('classifies answer-assembly rejection separately and retains individually valid claims', () => {
    const claim = 'The OCR line appears to show about 8.8 g of protein, but its serving basis is unresolved.';
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer: 'This is a great daily snack.',
      claims: [{ mode: 'synthesis', text: claim, observationIds: ['ocr-line-1'], sourceIds: [], supportingSpans: [observationSpan] }],
      answerParts: [{ text: 'This is a great daily snack with 9 g sugar. ' + claim, claimIndexes: [0] }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage, diagnostic: event => events.push(event) });

    expect(result.claims[0].text).toBe(claim);
    expect(result.answer).toContain('could not safely assemble it into a clear answer');
    expect(result.answer).not.toContain('8.8 g of protein');
    expect(result.answer).not.toContain('9 g sugar');
    expect(result.answer).not.toContain('great daily snack');
    expect(events).toContainEqual({ stage: 'answer-part', index: 0, decision: 'rejected', reason: 'unsupported-numeric-value' });
    expect(events).toContainEqual({ stage: 'answer-part', index: -1, decision: 'rejected', reason: 'grounded-claims-answer-unavailable' });
  });

  it('keeps a supported package-specific judgment while dropping only an unsupported numeric sentence',()=>{
    const answer='The label lists refined wheat flour, so I would treat this as an occasional rather than a good daily snack. Each serving contains 80 g of carbohydrate.';
    const flourLine={id:'flour-label-line',field:'ocr-line',text:'REFINED WHEAT FLOUR (MAIDA); CARBOHYDRATES 69.29 g',side:'back' as const,confidence:84,origin:'ocr' as const,imageId:'synthetic-image',readingOrder:{runId:'synthetic-run',blockIndex:1,paragraphIndex:0,lineIndex:1}};
    const pkg=packageSchema.parse({...fixturePackage,observations:[...fixturePackage.observations,flourLine],rawText:`${fixturePackage.rawText}\n${flourLine.text}`});
    const events:{stage:string;index:number;decision:string;reason?:string}[]=[];
    const result=validateInferenceOutput({
      answer,
      claims:[{mode:'synthesis',text:'The label lists refined wheat flour (maida) as an ingredient and lists 69.29 g of carbohydrates.',observationIds:['flour-label-line'],sourceIds:[],supportingSpans:[{kind:'observation',id:'flour-label-line',quote:flourLine.text}]}],
      limitations:[],inspectImage:null,
    },{package:pkg,question:'Is this good as a daily snack?',diagnostic:event=>events.push(event)});

    expect(result.answer).toBe('The label lists refined wheat flour, so I would treat this as an occasional rather than a good daily snack.');
    expect(events).toContainEqual({stage:'natural-answer',index:2,decision:'rejected',reason:'unsupported-numeric-value'});
    expect(events).toContainEqual({stage:'natural-answer',index:0,decision:'accepted'});
  });

  it('does not let a package-specific judgment exemption admit unsupported physiological comparisons',()=>{
    const answer='The label lists refined wheat flour, so I would treat this as an occasional rather than a daily snack. Refined carbohydrates may raise blood glucose faster than high-fibre alternatives.';
    const flourLine={id:'flour-label-line',field:'ocr-line',text:'REFINED WHEAT FLOUR (MAIDA)',side:'back' as const,confidence:84,origin:'ocr' as const,imageId:'synthetic-image',readingOrder:{runId:'synthetic-run',blockIndex:1,paragraphIndex:0,lineIndex:1}};
    const pkg=packageSchema.parse({...fixturePackage,observations:[...fixturePackage.observations,flourLine],rawText:`${fixturePackage.rawText}\n${flourLine.text}`});
    const events:{stage:string;index:number;decision:string;reason?:string}[]=[];
    const result=validateInferenceOutput({
      answer,
      claims:[{mode:'synthesis',text:'The label lists refined wheat flour as an ingredient.',observationIds:['flour-label-line'],sourceIds:[],supportingSpans:[{kind:'observation',id:'flour-label-line',quote:flourLine.text}]}],
      limitations:[],inspectImage:null,
    },{package:pkg,question:'Is this good as a daily snack for diabetes?',diagnostic:event=>events.push(event)});

    expect(result.answer).toBe('The label lists refined wheat flour, so I would treat this as an occasional rather than a daily snack.');
    expect(events).toContainEqual({stage:'natural-answer',index:2,decision:'rejected',reason:'comparative-judgment-needs-reference'});
  });

  it('accepts exact citations to a source record limitation', () => {
    const source = {
      id: 'assessment-source', title: 'Assessment record', publisher: 'Public authority',
      url: 'https://example.org/assessment', category: 'assessment' as const, jurisdiction: 'European Union',
      publishedAt: '2026-01-01', effectiveAt: null, retrievedAt: '2026-01-02',
      summary: 'This assessment discusses a substance under stated conditions.',
      limitations: 'It does not establish product presence, dose or personal safety.',
    };
    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis', text: 'The assessment does not establish this product’s dose or personal safety.',
        observationIds: [], sourceIds: [source.id],
        supportingSpans: [{ kind: 'source', id: source.id, quote: source.limitations }],
      }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage, evidence: [source] });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain('dose or personal safety');
    expect(result.answer).toContain('could not safely assemble it into a clear answer');
  });

  it('keeps dose and exposure limitations while withholding personalized safety and treatment advice', () => {
    const result = validateInferenceOutput({
      answer: '',
      claims: [
        {
          mode: 'synthesis',
          text: 'This OCR line does not state a dose, so product amount and dietary exposure cannot be calculated.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'This product is safe for you.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'The available record does not establish that this product is safe for you.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'You should avoid this product to treat diabetes.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toHaveLength(2);
    expect(result.claims.map(claim => claim.text).join(' ')).toContain('does not state a dose');
    expect(result.claims.map(claim => claim.text).join(' ')).not.toContain('This product is safe for you.');
    expect(result.claims.map(claim => claim.text).join(' ')).toContain('does not establish that this product is safe');
    expect(result.claims.map(claim => claim.text).join(' ')).not.toContain('avoid this product');
    expect(result.answer).toContain('could not safely assemble it into a clear answer');
  });

  it('withholds numeric synthesis that conflicts with cited OCR while allowing equivalent units', () => {
    const result = validateInferenceOutput({
      answer: '',
      claims: [
        {
          mode: 'synthesis',
          text: 'The OCR appears to show 80.8 g of protein, but its basis is unresolved.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
        {
          mode: 'synthesis',
          text: 'The OCR may show 8800 mg of protein, but its basis is unresolved.',
          observationIds: ['ocr-line-1'],
          sourceIds: [],
          supportingSpans: [observationSpan],
        },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain('8800 mg');
    expect(result.answer).not.toContain('80.8 g');
  });

  it('normalizes decimal-comma values before comparing grounded quantities', () => {
    const europeanPackage = packageSchema.parse({
      ...fixturePackage,
      id: 'synthetic-european-package',
      observations: [{ id: 'ocr-line-eu', field: 'ocr-line', text: 'Fibre 1.234,5 mg', side: 'back', confidence: 80, origin: 'ocr' }],
      ocrCaptures: [],
      rawText: 'Fibre 1.234,5 mg',
      nutrients: [],
    });
    const span = { kind: 'observation' as const, id: 'ocr-line-eu', quote: 'Fibre 1.234,5 mg' };
    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The label may report 1.2345 g of fibre.',
        observationIds: ['ocr-line-eu'],
        sourceIds: [],
        supportingSpans: [span],
      }],
      limitations: [],
      inspectImage: null,
    }, { package: europeanPackage });

    expect(result.claims).toHaveLength(1);
  });

  it('normalizes energy, volume and percentage quantities without crossing dimensions', () => {
    const cases = [
      { source: 'Energy 4.1840 kJ', claim: 'The line may show 1 kcal.' },
      { source: 'Volume 1 l', claim: 'The line may show 1000 ml.' },
      { source: 'Guidance 10 percent', claim: 'The cited guidance says 10%.' },
    ];
    for (const [index, item] of cases.entries()) {
      const observationId = `ocr-unit-${index}`;
      const pkg = packageSchema.parse({
        ...fixturePackage,
        id: `synthetic-unit-package-${index}`,
        observations: [{ id: observationId, field: 'ocr-line', text: item.source, side: 'back', confidence: 80, origin: 'ocr' }],
        ocrCaptures: [],
        rawText: item.source,
        nutrients: [],
      });
      const result = validateInferenceOutput({
        answer: '',
        claims: [{
          mode: 'synthesis',
          text: item.claim,
          observationIds: [observationId],
          sourceIds: [],
          supportingSpans: [{ kind: 'observation', id: observationId, quote: item.source }],
        }],
        limitations: [],
        inspectImage: null,
      }, { package: pkg });

      expect(result.claims).toHaveLength(1);
    }
  });

  it('checks paraphrased quantities and permits truthful rounding of cited deterministic results', () => {
    const calculation: Calculation = {
      id: 'calc-protein-50g',
      label: 'Protein for 50 g',
      nutrient: 'protein',
      input: 8.88,
      inputUnit: 'g',
      basisAmount: 100,
      portion: 50,
      portionUnit: 'g',
      result: 4.44,
      unit: 'g',
      formula: '8.88 g × 50 g ÷ 100 g',
      evidenceText: 'A 50 g portion using 8.88 g protein per 100 g calculates to 4.44 g protein.',
      observationIds: ['ocr-line-1'],
      assumptions: ['The OCR reading is unverified.'],
    };
    const span = { kind: 'calculation' as const, id: calculation.id, quote: calculation.evidenceText! };
    const result = validateInferenceOutput({
      answer: 'A 50 g portion has about 4.4 g protein.',
      answerParts:[{text:'A 50 g portion has about 4.4 g protein.',claimIndexes:[0]}],
      claims: [
        {
          mode: 'synthesis',
          text: 'A 50 g portion calculates to about 4.4 g protein.',
          observationIds: [],
          sourceIds: [],
          calculationIds: [calculation.id],
          supportingSpans: [span],
        },
        {
          mode: 'synthesis',
          text: 'A 50 g portion calculates to 4.5 g protein.',
          observationIds: [],
          sourceIds: [],
          calculationIds: [calculation.id],
          supportingSpans: [span],
        },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, calculations: [calculation] });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain('4.4 g');
    expect(result.answer).not.toContain('4.5 g');
    expect(result.answer).toContain('50 g portion');
  });

  it('does not round a small nonzero calculated nutrient down to a claimed zero',()=>{
    const calculation:Calculation={
      id:'calc-trace',label:'Trace amount for 10 g',nutrient:'protein',input:0.4,inputUnit:'g',basisAmount:100,
      portion:10,portionUnit:'g',result:0.04,unit:'g',formula:'0.4 g × 10 g ÷ 100 g',
      evidenceText:'A 10 g portion calculates to 0.04 g protein.',observationIds:['ocr-line-1'],assumptions:[],
    };
    const result=validateInferenceOutput({answer:'',claims:[{
      mode:'synthesis',text:'A 10 g portion has 0 g protein.',observationIds:[],sourceIds:[],calculationIds:[calculation.id],
    }],limitations:[],inspectImage:null},{package:fixturePackage,calculations:[calculation]});

    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('0 g protein');
  });

  it('drops a forged quotation even when it uses a real observation identifier', () => {
    const result = validateInferenceOutput({
      answer: 'Sodium is 500 mg.',
      claims: [{
        mode: 'direct-quote',
        text: 'Sodium 500 mg',
        observationIds: ['ocr-line-1'],
        sourceIds: [],
        supportingSpans: [{ ...observationSpan, quote: 'Sodium 500 mg' }],
      }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.claims).toEqual([]);
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(result.answer).not.toContain('Sodium 500 mg');
  });

  it('retains a traceable OCR candidate as tentative without mutating package facts', () => {
    const before = structuredClone(fixturePackage);
    const candidate = {
      candidateId: 'candidate-protein-1',
      kind: 'nutrient',
      field: 'protein',
      proposedValue: '8.8 g',
      numericValue: 8.8,
      unit: 'g',
      basis: null,
      normalizedEntity: 'protein',
      status: 'tentative',
      observationIds: ['ocr-line-1'],
      sourceIds: [],
      supportingSpans: [observationSpan],
      ocrWordEvidence: [{ observationId: 'ocr-line-1', role: 'value', wordIndexes: [2, 3] }],
      uncertainty: 'The reading is approximate and the serving basis is unknown.',
    };

    const result = validateInferenceOutput({
      answer: '',
      claims: [],
      tentativeCandidates: [candidate],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage });

    expect(result.tentativeCandidates).toHaveLength(1);
    expect(result.tentativeCandidates[0]).toMatchObject({
      status: 'tentative', numericValue: candidate.numericValue, observationIds: candidate.observationIds,
    });
    expect(result.tentativeCandidates[0].uncertainty).toMatch(/links are incomplete/i);
    expect(result.answer).toContain('possible readings');
    expect(result.answer).not.toContain('8.8 g');
    expect(fixturePackage).toEqual(before);
    expect(fixturePackage.nutrients).toEqual([]);
  });

  it('preserves a photo-backed candidate with partial OCR links but keeps it out of calculations', () => {
    const unlinkedObservation = {
      id: 'ocr-line-unlinked-basis', field: 'ocr-line' as const, text: 'QUANTITY PER 100 g', side: 'back' as const,
      confidence: 80, origin: 'ocr' as const, imageId: 'synthetic-image',
      readingOrder: { runId: 'synthetic-run', blockIndex: 0, paragraphIndex: 0, lineIndex: 1 },
    };
    const pkg = packageSchema.parse({
      ...fixturePackage,
      observations: [...fixturePackage.observations, unlinkedObservation],
      rawText: `${fixturePackage.rawText}\n${unlinkedObservation.text}`,
    });
    const candidate = {
      candidateId: 'vision-protein-partial-links',
      kind: 'nutrient', field: 'protein', proposedValue: '9.2 g', numericValue: 9.2, unit: 'g',
      basis: { amount: 100, unit: 'g', description: 'per 100 g' }, normalizedEntity: 'protein', status: 'tentative',
      observationIds: ['ocr-line-1', unlinkedObservation.id], sourceIds: [], supportingSpans: [observationSpan],
      ocrWordEvidence: [{ observationId: 'ocr-line-1', role: 'value', wordIndexes: [2, 3] }],
      visualEvidence: [
        { imageId: 'synthetic-image', visibleText: 'Protein 9.2 g', region: { x: 0.2, y: 0.3, width: 0.3, height: 0.05 } },
        { imageId: 'synthetic-image', visibleText: 'Per 100 g', region: { x: 0.5, y: 0.25, width: 0.2, height: 0.05 } },
      ],
      uncertainty: 'The OCR line and photo reading disagree; confirm the printed value.',
    };

    const result = validateInferenceOutput({ answer: '', claims: [], tentativeCandidates: [candidate], limitations: [], inspectImage: null }, {
      package: pkg, images: [{ handle: 'synthetic-image' }],
    });

    expect(result.tentativeCandidates).toHaveLength(1);
    expect(result.tentativeCandidates[0]).toMatchObject({
      status: 'tentative', observationIds: ['ocr-line-1'], supportingSpans: [observationSpan],
    });
    expect(result.tentativeCandidates[0].uncertainty).toMatch(/links are incomplete/i);
    const reconciled = reconcileInterpretedNutrition(pkg, result.tentativeCandidates, ['synthetic-image']);
    expect(reconciled.readings).toEqual([]);
    expect(reconciled.withheld[0].reason).toMatch(/interpretation of the photo/i);
  });

  it('keeps image-linked numbers tentative and does not let the model corroborate its own visual reading', () => {
    const before = structuredClone(fixturePackage);
    const visualEvidence = {
      imageId: 'synthetic-image',
      visibleText: 'Protein 5.7 g per 70 g',
      region: { x: 0.2, y: 0.3, width: 0.4, height: 0.12 },
    };
    const candidate = {
      candidateId: 'vision-protein-1',
      kind: 'nutrient',
      field: 'protein',
      proposedValue: '5.7 g',
      numericValue: 5.7,
      unit: 'g',
      basis: { amount: 70, unit: 'g', description: 'per serving' },
      normalizedEntity: 'protein',
      status: 'tentative',
      observationIds: [],
      sourceIds: [],
      supportingSpans: [],
      visualEvidence: [visualEvidence],
      uncertainty: 'The image reading is model-reported and has not been independently verified.',
    };

    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The photo appears to show 5.7 g protein per 70 g serving.',
        observationIds: [],
        sourceIds: [],
        supportingSpans: [],
        visualEvidence: [visualEvidence],
      }],
      tentativeCandidates: [candidate],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(result.claims).toHaveLength(0);
    expect(result.answer).toContain('possible readings');
    expect(result.answer).not.toContain('5.7 g protein');
    expect(result.answer).not.toContain('[image:synthetic-image]');
    expect(result.tentativeCandidates).toHaveLength(1);
    expect(result.tentativeCandidates[0]).toMatchObject({
      status: 'tentative', numericValue: candidate.numericValue, visualEvidence: [visualEvidence],
    });
    expect(result.tentativeCandidates[0].uncertainty).toMatch(/links are incomplete/i);
    expect(fixturePackage).toEqual(before);
    expect(fixturePackage.nutrients).toEqual([]);
  });

  it('rejects unknown image references and numeric visual claims unsupported by the reported text', () => {
    const visualEvidence = { imageId: 'synthetic-image', visibleText: 'Protein 5.7 g per 70 g', region: null };
    const output = {
      answer: '',
      claims: [{
        mode: 'synthesis',
        text: 'The photo appears to show 5.8 g protein per 70 g serving.',
        observationIds: [],
        sourceIds: [],
        supportingSpans: [],
        visualEvidence: [visualEvidence],
      }],
      limitations: [],
      inspectImage: null,
    };

    expect(validateInferenceOutput(output, { package: fixturePackage }).claims).toEqual([]);
    const result = validateInferenceOutput(output, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });
    expect(result.claims).toEqual([]);
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(result.answer).not.toContain('5.8 g');
  });

  it('returns typed errors for malformed output while withholding only a claim with unknown evidence', () => {
    expect(() => validateInferenceOutput({ nope: true }, { package: fixturePackage })).toThrowError(InferenceModuleError);
    const decisions: Array<{ stage: string; index: number; decision: string; reason?: string }> = [];
    const result = validateInferenceOutput({
      answer: '',
      claims: [{
        mode: 'direct-quote',
        text: 'Missing evidence',
        observationIds: ['missing'],
        sourceIds: [],
        supportingSpans: [{ kind: 'observation', id: 'missing', quote: 'Missing evidence' }],
      }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, diagnostic: event => decisions.push(event) });
    expect(result.claims).toEqual([]);
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(decisions).toContainEqual({ stage: 'claim', index: 0, decision: 'rejected', reason: 'unknown-evidence-id' });
  });

  it('keeps only unique UI requests whose backing evidence exists and can be rendered', () => {
    const productSource = {
      id: 'community-oats', title: 'Example Oats', publisher: 'Open Food Facts community database',
      url: 'https://world.openfoodfacts.org/product/123456789', category: 'product' as const, jurisdiction: 'India',
      publishedAt: null, effectiveAt: null, retrievedAt: '2026-10-22T00:00:00.000Z', summary: 'Protein: 13 g per 100 g',
      limitations: 'Community record; verify the variant.',
    };
    const result = validateInferenceOutput({
      answer: '', claims: [], limitations: [], inspectImage: null,
      uiComponents: [
        { type: 'nutrition-table', observationIds: ['ocr-line-1'], sourceIds: [], calculationIds: [] },
        { type: 'nutrition-table', observationIds: ['ocr-line-1'], sourceIds: [], calculationIds: [] },
        { type: 'package-evidence', observationIds: ['not-present'], sourceIds: [], calculationIds: [] },
        { type: 'product-comparison', observationIds: ['ocr-line-1'], sourceIds: ['community-oats'], calculationIds: [] },
        { type: 'source-reference-cards', observationIds: [], sourceIds: ['unknown-source'], calculationIds: [] },
      ],
    }, { package: fixturePackage, evidence: [productSource] });

    expect(result.uiComponents.map(component => component.type)).toEqual(['nutrition-table', 'product-comparison']);
    expect(result.uiComponents[1].sourceIds).toEqual(['community-oats']);
  });

  it('keeps contextual UI requests backed by saved photo-linked reconstruction without raw OCR lines', () => {
    const imageRegion = { imageId: 'back-photo', region: { x: 0.1, y: 0.15, width: 0.7, height: 0.35 } };
    const reconstruction = {
      identity: { brand: 'Example', name: 'Cream crackers', variant: 'Unsweetened', status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [imageRegion] } },
      serving: { printedText: '2 crackers (13 g)', quantity: 13, unit: 'g' as const, pieceCount: 2, pieceDescription: 'crackers', status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [imageRegion] } },
      nutritionRows: [{ rowId: 'carb-100g', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '68 g', value: 68, unit: 'g', columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g' as const, qualifier: null, status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [imageRegion] } }],
      ingredients: [{ position: 0, name: 'Refined wheat flour', printedText: 'Refined wheat flour (maida)', printedPercentage: 89, normalizedName: 'refined wheat flour', status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [imageRegion] } }],
      additives: [],
      statements: [{ kind: 'claim' as const, label: 'sugar claim', text: 'No added sugar', status: 'provisional' as const, evidence: { observationIds: [], imageRegions: [imageRegion] } }],
      regions: [], unresolved: [], interpretationNote: 'Photo-linked provisional reconstruction.',
      revision: 1, updatedAt: '2026-10-24T00:00:00.000Z', model: 'fixture-model', current: true,
    };
    const pkg = packageSchema.parse({
      ...fixturePackage, observations: [], ocrCaptures: [], rawText: '',
      visionCaptures: [{ runId: 'vision-run', imageId: 'back-photo', side: 'back', sourceImage: { width: 900, height: 363 }, processing: { rotation: 0, contrast: false, invert: false, crop: null }, model: 'fixture-model' }],
      reconstruction,
    });
    const result = validateInferenceOutput({
      answer: '', claims: [], limitations: [], inspectImage: null,
      uiComponents: [
        { type: 'nutrition-table', observationIds: [], sourceIds: [], calculationIds: [] },
        { type: 'ingredient-explorer', observationIds: [], sourceIds: [], calculationIds: [] },
        { type: 'allergen-explanation', observationIds: [], sourceIds: [], calculationIds: [] },
        { type: 'package-details', observationIds: [], sourceIds: [], calculationIds: [] },
      ],
    }, { package: pkg, images: [{ handle: 'back-photo' }] });

    expect(result.uiComponents.map(component => component.type)).toEqual([
      'nutrition-table', 'ingredient-explorer', 'allergen-explanation', 'package-details',
    ]);
  });

  it('shows a personalized UI choice only when a validated claim cites supplied profile context', () => {
    const profile = { ...defaultProfile, goals: 'Understand the nutrition label.' };
    const output = {
      answer: '',
      claims: [{
        mode: 'direct-quote' as const,
        text: profile.goals,
        observationIds: [], sourceIds: [], profileFieldIds: ['goals'],
        supportingSpans: [{ kind: 'profile' as const, id: 'goals', quote: profile.goals }],
      }],
      limitations: [], inspectImage: null,
      uiComponents: [{ type: 'personalized-finding' as const, observationIds: [], sourceIds: [], calculationIds: [] }],
    };
    expect(validateInferenceOutput({ ...output, claims: [] }, { package: fixturePackage }).uiComponents).toEqual([]);
    expect(validateInferenceOutput(output, { package: fixturePackage, profile }).uiComponents).toEqual(output.uiComponents);
  });
});
