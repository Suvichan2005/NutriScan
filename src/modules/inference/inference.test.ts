import { describe, expect, it } from 'vitest';
import { defaultProfile, packageReconstructionContentSchema, packageSchema, tentativeStructuredCandidateSchema, type Calculation, type PackageData } from '../../lib/contracts';
import { reconcileInterpretedNutrition } from '../../lib/interpreted-nutrients';
import { packageForAssist } from './evidence';
import { InferenceModuleError, validateInferenceOutput, validateNaturalAnswerText } from './index';
import { applyNutrientCorrection } from '../../lib/correction';

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

function reconstructionFixture() {
  const imageEvidence = [{ imageId: 'synthetic-image', region: null }];
  const evidence = { observationIds: [], imageRegions: imageEvidence };
  return packageReconstructionContentSchema.parse({
    identity: { brand: 'Example', name: 'Crackers', variant: 'Sugar Free', status: 'provisional', evidence },
    serving: { printedText: '2 biscuits (13.4 g)', quantity: 13.4, unit: 'g', pieceCount: 2, pieceDescription: 'biscuits', status: 'provisional', evidence },
    nutritionRows: [{ rowId: 'carbohydrate-per-100g', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '69.29 g', value: 69.29, unit: 'g', columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence }],
    ingredients: [{ position: 0, name: 'Refined wheat flour', printedText: 'REFINED WHEAT FLOUR (MAIDA)', printedPercentage: 89.98, normalizedName: 'refined wheat flour', status: 'provisional', evidence }],
    additives: [],
    statements: [{ kind: 'claim', label: 'Sugar free', text: 'FREE OF SUGAR', status: 'provisional', evidence }],
    regions: [],
    unresolved: [],
    interpretationNote: 'Provisional package interpretation.',
  });
}

describe('provider-independent inference output validation', () => {
  it('returns only typed calculations that support accepted natural-answer quantities',()=>{
    const makeCalculation=(id:string,nutrient:'energy'|'fiber'|'fat'|'sodium',result:number,unit:string):Calculation=>({
      id,label:`${nutrient} in 45 g`,nutrient,input:result,inputUnit:unit,basisAmount:100,portion:45,portionUnit:'g',result,unit,
      formula:'typed package calculation',observationIds:[],assumptions:[],
    });
    const calculations=[
      makeCalculation('energy-45g','energy',169.2,'kcal'),
      makeCalculation('fiber-45g','fiber',5.58,'g'),
      makeCalculation('fat-45g','fat',4.455,'g'),
      makeCalculation('sodium-45g','sodium',1027.35,'mg'),
    ];
    const checked=validateNaturalAnswerText('For 45 g: energy is 169.2 kcal, dietary fibre is 5.58 g, and sodium is 1027.35 mg.',{
      package:fixturePackage,question:'How much energy, fibre and sodium in 45 g?',calculations,
    });
    expect(checked.answer).toContain('energy is 169.2 kcal');
    expect(checked.calculationIds).toEqual(['energy-45g','fiber-45g','sodium-45g']);
    const rejected=validateNaturalAnswerText('Energy is 169.2 kcal. Fat is 99 g.',{
      package:fixturePackage,calculations,
    });
    expect(rejected.calculationIds).toEqual(['energy-45g']);
    expect(rejected.answer).not.toContain('Fat is 99 g');
  });

  it('does not let superseded model rows, original text or old calculations override a correction', () => {
    const pkg=packageSchema.parse({...fixturePackage,nutrients:[],observations:[{id:'drink-label',field:'label-note',text:'Protein 3.2 g per 100 ml',origin:'user',side:'text',confidence:null}],reconstruction:{
      ...reconstructionFixture(),revision:1,updatedAt:'2026-10-25T00:00:00.000Z',model:'fixture',current:true,serving:null,ingredients:[],statements:[],
      nutritionRows:[{rowId:'drink-protein',nutrient:'protein',printedLabel:'Protein',printedValue:'3.2 g',value:3.2,unit:'g',columnLabel:'Per 100 ml',basisText:'per 100 ml',basisAmount:100,basisUnit:'ml',qualifier:null,status:'provisional',evidence:{observationIds:['drink-label'],imageRegions:[]}}],
    }});
    const corrected=applyNutrientCorrection(pkg,{key:'protein',value:3.4,unit:'g',basisAmount:100,basisUnit:'ml'});
    const stale:Calculation={id:'old-drink-calculation',label:'Protein in 250 ml',nutrient:'protein',input:3.2,inputUnit:'g',basisAmount:100,portion:250,portionUnit:'ml',result:8,unit:'g',formula:'3.2 × 250 ÷ 100',observationIds:['drink-label'],interpretationIds:['drink-protein'],assumptions:[]};
    const checked=validateNaturalAnswerText('The current label value is 3.4 g protein per 100 ml. It provides 8 g protein in 250 ml.',{package:corrected,calculations:[stale]});
    expect(checked.answer).toContain('3.4 g protein per 100 ml');
    expect(checked.answer).not.toContain('8 g protein');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(1);
    expect(validateNaturalAnswerText('Protein is 3.2 g per 100 ml.',{package:corrected}).answer).toBe('');
    expect(corrected.reconstruction?.nutritionRows[0].value).toBe(3.2);
    expect(corrected.observations.find(row=>row.id==='drink-label')?.text).toBe('Protein 3.2 g per 100 ml');
  });
  it('keeps natural prose and checks only quantities against canonical package rows and tools', () => {
    const pkg = packageSchema.parse({
      ...fixturePackage,
      reconstruction: {
        ...reconstructionFixture(), revision: 1, updatedAt: '2026-10-24T00:00:00.000Z', model: 'fixture-model', current: true,
      },
    });
    const checked = validateNaturalAnswerText(
      'This is a refined-flour-heavy cracker. The label appears to list 69.29 g carbohydrate per 100 g.',
      { package: pkg, question: 'What can you tell me about it?' },
    );
    expect(checked.answer).toContain('This is a refined-flour-heavy cracker.');
    expect(checked.answer).toContain('69.29 g carbohydrate per 100 g.');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(0);

    const mixed = validateNaturalAnswerText(
      'This is a refined-flour-heavy cracker. It contains 99 g carbohydrate per 100 g.',
      { package: pkg, question: 'What can you tell me about it?' },
    );
    expect(mixed.answer).toContain('This is a refined-flour-heavy cracker.');
    expect(mixed.answer).not.toContain('99 g');
    expect(mixed.withheldUnsupportedQuantitySentenceCount).toBe(1);
  });

  it('does not treat a numeric value in raw OCR as a usable package quantity', () => {
    const checked = validateNaturalAnswerText(
      'The package lists 8.8 g protein per 100 g.',
      { package: fixturePackage, question: 'What can you tell me about it?' },
    );
    expect(checked.answer).toBe('');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(1);
  });

  it('preserves list numbering and retrieved publication years without accepting invented quantities or dates',()=>{
    const source={id:'dated-review',title:'Example intervention review',publisher:'Example scientific journal',url:'https://example.org/article/35631184/',category:'literature' as const,jurisdiction:'Study population',publishedAt:'2022-11-01',effectiveAt:null,retrievedAt:'2026-10-25T00:00:00Z',summary:'An intervention review with population and exposure limitations.',limitations:'No package-specific dose is established.'};
    const checked=validateNaturalAnswerText([
      '1. What the review found',
      '* Source: Example intervention review (2022).',
      '2. The label does not establish the studied dose.',
      '3. The product contains 99 g protein.',
      '* A different review was published in 2021.',
    ].join('\n'),{package:fixturePackage,question:'Explain the review.',evidence:[source]});
    expect(checked.answer).toContain('1. What the review found');
    expect(checked.answer).toContain('Source: Example intervention review (2022).');
    expect(checked.answer).toContain('2. The label does not establish the studied dose.');
    expect(checked.answer).not.toContain('99 g');
    expect(checked.answer).not.toContain('2021');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(2);
    const withoutDate=validateNaturalAnswerText('Source: Example intervention review (2022).',{package:fixturePackage,evidence:[{...source,publishedAt:null}]});
    expect(withoutDate.answer).toBe('');
    const identifier=validateNaturalAnswerText('The review record is 35631184.',{package:fixturePackage,evidence:[source]});
    expect(identifier.withheldUnsupportedQuantitySentenceCount).toBe(0);
    const inventedIdentifier=validateNaturalAnswerText('The review record is 35631185.',{package:fixturePackage,question:'Is record 35631185 relevant?',evidence:[source]});
    expect(inventedIdentifier.answer).toBe('');
  });

  it('keeps dose time bases with quantities instead of borrowing package amounts or requested doses',()=>{
    const source={id:'dose-trial',title:'Example human intervention trial',publisher:'Example scientific journal',url:'https://example.org/trial',category:'literature' as const,jurisdiction:'Trial population',publishedAt:'2022',effectiveAt:null,retrievedAt:'2026-10-25',summary:'The intervention used 6 grams/day of the studied fibre.',limitations:'This trial dose is not a personal target.'};
    const pkg=packageSchema.parse({...fixturePackage,observations:[...fixturePackage.observations,{id:'user-fat',field:'fat',text:'Fat 3 g per 100 g',origin:'user',side:'text',confidence:null}]});
    const context={package:pkg,question:'Does the evidence support 3 g/day?',evidence:[source]};
    for(const answer of ['The trial used 6 g/day.','The trial used 6000 mg per day.']){
      expect(validateNaturalAnswerText(answer,context).withheldUnsupportedQuantitySentenceCount).toBe(0);
    }
    for(const answer of ['The trial used 3 g per day.','The trial used 6 g per week.','Trials typically used around 3 g or more of fibre per day.']){
      const checked=validateNaturalAnswerText(answer,context);
      expect(checked.answer).toBe('');
      expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(1);
    }
    expect(validateNaturalAnswerText('The package lists 3 g fat per 100 g.',context).withheldUnsupportedQuantitySentenceCount).toBe(0);
  });

  it('keeps numbered Markdown headings while checking quantities inside their content',()=>{
    const checked=validateNaturalAnswerText([
      '### 1. Ingredient origins',
      '## 2) What remains uncertain',
      '### 3. Contains 99 g protein.',
      '# Source findings',
    ].join('\n'),{package:fixturePackage});
    expect(checked.answer).toContain('### 1. Ingredient origins');
    expect(checked.answer).toContain('## 2) What remains uncertain');
    expect(checked.answer).toContain('# Source findings');
    expect(checked.answer).not.toContain('99 g');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(1);
  });

  it('recognizes a source-linked declared serving as the basis for natural prose',()=>{
    const pkg=packageSchema.parse({...fixturePackage,reconstruction:{
      ...reconstructionFixture(),revision:1,updatedAt:'2026-10-25T00:00:00.000Z',model:'fixture-model',current:true,
    }});

    const checked=validateNaturalAnswerText(
      'The package declares a 13.4 g serving, and this amount is described per serving.',
      {package:pkg,question:'How much is one serving?'},
    );

    expect(checked.answer).toContain('described per serving');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(0);
  });

  it('keeps useful natural prose and gives a concise notice when unsupported quantity detail is withheld', () => {
    const checked = validateNaturalAnswerText(
      'This is a refined-flour-heavy cracker. It contains 99 g carbohydrate per 100 g.',
      { package: fixturePackage, question: 'Is this a sensible snack?' },
    );
    expect(checked.answer).toContain('This is a refined-flour-heavy cracker.');
    expect(checked.answer).toContain('I omitted one or more numerical statements that the available evidence could not verify');
    expect(checked.answer).not.toContain('99 g');
    expect(checked.answer).not.toContain('against the saved package or retrieved evidence');
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(1);
  });

  it('uses a count-neutral notice when several unsupported numerical statements are withheld', () => {
    const checked = validateNaturalAnswerText(
      'This is a packaged cracker. It has 99 g carbohydrate per 100 g. It contains 31 g sugar per serving.',
      { package: fixturePackage, question: 'What should I know about this cracker?' },
    );
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(2);
    expect(checked.answer).toContain('I omitted one or more numerical statements that the available evidence could not verify');
  });

  it('preserves supported Markdown answer lines when one approximate quantity is unsupported',()=>{
    const baseReconstruction=reconstructionFixture();
    const evidence=baseReconstruction.nutritionRows[0].evidence;
    const pkg=packageSchema.parse({...fixturePackage,reconstruction:{
      ...baseReconstruction,
      serving:{printedText:'38 g serving',quantity:38,unit:'g',pieceCount:1,pieceDescription:'pack',status:'provisional',evidence},
      nutritionRows:[...baseReconstruction.nutritionRows,{rowId:'fiber-per-100g',nutrient:'Dietary fibre',printedLabel:'Dietary fibre',printedValue:'12.4 g',value:12.4,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence}],
      revision:1,updatedAt:'2026-10-25T00:00:00.000Z',model:'fixture-model',current:true,
    }});
    const calculation:Calculation={
      id:'portion-fiber',label:'fiber per serving (38 g)',nutrient:'fiber',
      input:12.4,inputUnit:'g',basisAmount:100,portion:38,portionUnit:'g',result:12.4*38/100,unit:'g',
      formula:'12.4 g × 38 g ÷ 100 g',evidenceText:'fiber per serving (38 g); per 38 g; 12.4 g × 38 g ÷ 100 g = 4.712 g',
      observationIds:[],imageIds:['synthetic-image'],interpretationIds:['fiber-per-100g'],assumptions:[],
    };
    const answer=[
      '### Portion',
      '* The label lists 69.29 g carbohydrate per 100 g.',
      '* A 38 g serving provides ~4.7 g fibre.',
      '* It provides 99 g fibre per 38 g.',
    ].join('\n');

    const checked=validateNaturalAnswerText(answer,{package:pkg,question:'How much fibre in 38 g?',calculations:[calculation]});

    expect(checked.answer).toContain('### Portion');
    expect(checked.answer).toContain('~4.7 g fibre.');
    expect(checked.answer).not.toContain('99 g');
    expect(checked.answer).toContain('I omitted one or more numerical statements that the available evidence could not verify');
    expect(checked.acceptedSentenceCount).toBe(3);
    expect(checked.withheldUnsupportedQuantitySentenceCount).toBe(1);
  });

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

  it("keeps Gemini's natural answer as the only conversational answer", () => {
    const reconstruction = reconstructionFixture();
    const answer = "The ingredient list puts refined wheat flour first. The label appears to list 69.29 g of carbohydrates per 100 g, so this is better as an occasional than a default daily snack.";
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstruction,
      claims: [
        { mode: 'synthesis', text: 'The ingredient list places refined wheat flour first.', observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0'] },
        { mode: 'synthesis', text: 'Carbohydrates appear to be 69.29 g per 100 g.', observationIds: [], sourceIds: [], interpretationRowIds: ['carbohydrate-per-100g'] },
      ],
      answerParts: [{ text: answer, claimIndexes: [0, 1] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(result.answer).toBe(answer);
    expect(result.claims).toHaveLength(2);
    expect(result.answer).not.toContain('Evidence-linked interpretation');
    expect(result.answer).not.toContain('The label appears to list 69.29 g of carbohydrates per 100 g. The label appears to list');
  });

  it('withholds an unsupported numeric segment while retaining an independently grounded package statement', () => {
    const reconstruction = reconstructionFixture();
    const grounded = 'The ingredient list puts refined wheat flour first.';
    const unsupported = 'The table appears to list 969 g of carbohydrates per 100 g.';
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer: grounded + ' ' + unsupported,
      packageReconstruction: reconstruction,
      claims: [
        { mode: 'synthesis', text: grounded, observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0'] },
        { mode: 'synthesis', text: unsupported, observationIds: [], sourceIds: [], interpretationRowIds: ['carbohydrate-per-100g'] },
      ],
      answerParts: [
        { text: grounded, claimIndexes: [0] },
        { text: unsupported, claimIndexes: [1] },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], diagnostic: event => events.push(event) });

    expect(result.answer).toBe(grounded);
    expect(result.answer).not.toContain('969 g');
    expect(events).toContainEqual({ stage: 'claim', index: 1, decision: 'rejected', reason: 'unsupported-numeric-value' });
    expect(events).toContainEqual({ stage: 'answer-part', index: 1, decision: 'rejected', reason: 'unsupported-claim-link' });
  });

  it('does not manufacture evidence links by matching answer wording to package reconstruction', () => {
    const answer = 'The label appears to list 69.29 g of carbohydrates per 100 g and refined wheat flour first.';
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstructionFixture(),
      claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain('69.29 g');
    expect(result.answer).toContain('can’t establish a reliable answer');
  });

  it('validates a cited nutrition row by identity, value, unit and printed basis', () => {
    const reconstruction = reconstructionFixture();
    const validate = (text: string) => validateInferenceOutput({
      answer: text,
      packageReconstruction: reconstruction,
      claims: [{ mode: 'synthesis', text, observationIds: [], sourceIds: [], interpretationRowIds: ['carbohydrate-per-100g'] }],
      answerParts: [{ text, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(validate('The table appears to list 69.29 g of carbohydrates per 100 g.').answer)
      .toBe('The table appears to list 69.29 g of carbohydrates per 100 g.');
    expect(validate('The table appears to list 70 g of carbohydrates per 100 g.').answer)
      .not.toContain('70 g');
    expect(validate('The table appears to list 69.29 g of protein per 100 g.').answer)
      .not.toContain('69.29 g');
    expect(validate('The table appears to list 69.29 g of carbohydrates per serving.').answer)
      .not.toContain('69.29 g');
  });

  it('uses only explicitly referenced deterministic calculations for portion quantities', () => {
    const calculation: Calculation = {
      id: 'carbohydrate-two-biscuits',
      label: 'Carbohydrate in two biscuits',
      nutrient: 'carbohydrate',
      input: 69.29,
      inputUnit: 'g',
      basisAmount: 100,
      portion: 13.4,
      portionUnit: 'g',
      result: 9.28,
      unit: 'g',
      formula: '69.29 g × 13.4 g ÷ 100 g',
      evidenceText: 'Carbohydrates in two biscuits; 69.29 g per 100 g × 13.4 g ÷ 100 g = 9.28 g; provisional.',
      observationIds: [],
      imageIds: ['synthetic-image'],
      interpretationIds: ['carbohydrate-per-100g'],
      assumptions: ['Unverified package interpretation.'],
    };
    const answer = 'Two biscuits provide an estimated 9.28 g of carbohydrates.';
    const withCalculation = validateInferenceOutput({
      answer,
      packageReconstruction: reconstructionFixture(),
      claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [], calculationIds: [calculation.id], interpretationRowIds: ['carbohydrate-per-100g'], packageFactIds: ['package-fact:serving'] }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], calculations: [calculation] });
    const withoutCalculationReference = validateInferenceOutput({
      answer,
      packageReconstruction: reconstructionFixture(),
      claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [], interpretationRowIds: ['carbohydrate-per-100g'], packageFactIds: ['package-fact:serving'] }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], calculations: [calculation] });

    expect(withCalculation.answer).toBe(answer);
    expect(withCalculation.claims[0].calculationIds).toEqual([calculation.id]);
    expect(withoutCalculationReference.answer).not.toContain('9.28 g');
  });

  it('keeps a valid answer part when another part points to a missing claim', () => {
    const grounded = 'The ingredient list puts refined wheat flour first.';
    const result = validateInferenceOutput({
      answer: grounded + ' Unsupported extra sentence.',
      packageReconstruction: reconstructionFixture(),
      claims: [{ mode: 'synthesis', text: grounded, observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0'] }],
      answerParts: [
        { text: grounded, claimIndexes: [0] },
        { text: 'Unsupported extra sentence.', claimIndexes: [20] },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(result.answer).toBe(grounded);
  });

  it('preserves a mapped useful answer while withholding a rejected sibling claim', () => {
    const reconstruction = reconstructionFixture();
    const supportedAnswer = 'The first ingredient is refined wheat flour.';
    const unsupportedAnswer = 'It is medically safe for diabetes.';
    const answer = `${supportedAnswer} ${unsupportedAnswer}`;
    const events: { stage: string; index: number; decision: string; reason?: string }[] = [];
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstruction,
      claims: [
        { mode: 'synthesis', text: 'The ingredient list names refined wheat flour first.', observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0'] },
        { mode: 'synthesis', text: 'An unrelated unsupported finding.', observationIds: ['missing-observation'], sourceIds: [] },
      ],
      answerParts: [
        { text: supportedAnswer, claimIndexes: [0] },
        { text: unsupportedAnswer, claimIndexes: [1] },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], diagnostic: event => events.push(event) });

    expect(result.answer).toBe(supportedAnswer);
    expect(result.claims).toHaveLength(1);
    expect(events).toContainEqual({ stage: 'claim', index: 1, decision: 'rejected', reason: 'unknown-evidence-id' });
    expect(events).toContainEqual({ stage: 'natural-answer', index: 0, decision: 'accepted', reason: 'unsupported-answer-parts-withheld' });
  });

  it('still withholds a natural answer whose numeric claim is unsupported by the surviving references', () => {
    const reconstruction = reconstructionFixture();
    const answer = 'The label lists 999 g carbohydrates per 100 g; refined wheat flour is listed first.';
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstruction,
      claims: [
        { mode: 'synthesis', text: 'Refined wheat flour is listed first.', observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0'] },
        { mode: 'synthesis', text: 'The label lists 999 g carbohydrates per 100 g.', observationIds: ['missing-observation'], sourceIds: [] },
      ],
      answerParts: [
        { text: 'The label lists 999 g carbohydrates per 100 g;', claimIndexes: [1] },
        { text: 'refined wheat flour is listed first.', claimIndexes: [0] },
      ],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }] });

    expect(result.answer).not.toContain('999 g');
    expect(result.claims).toHaveLength(1);
  });

  it('requires an explicit reference when the answer names an external authority, but accepts a natural paraphrase', () => {
    const source = {
      id: 'efsa-assessment',
      title: 'EFSA food additive assessment',
      publisher: 'European Food Safety Authority',
      url: 'https://example.org/efsa-assessment',
      category: 'assessment' as const,
      jurisdiction: 'European Union',
      publishedAt: '2024-01-01',
      effectiveAt: null,
      retrievedAt: '2026-10-24',
      summary: 'The assessment describes toxicological reference values for the substance.',
      limitations: 'It does not establish product exposure or individual risk.',
    };
    const answer = 'The EFSA assessment describes a reference value, but does not establish exposure from this product.';
    const missingReference = validateInferenceOutput({
      answer,
      claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [] }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, evidence: [source] });
    const linkedAnswer='The assessment summarizes a toxicological reference value; that alone does not show how much is in this product.';
    const linkedReference = validateInferenceOutput({
      answer: linkedAnswer,
      claims: [{ mode: 'synthesis', text: 'The assessment summarizes a toxicological reference value.', observationIds: [], sourceIds: [source.id] }],
      answerParts: [{ text: linkedAnswer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, evidence: [source] });

    expect(missingReference.claims).toEqual([]);
    expect(missingReference.answer).not.toContain('EFSA assessment');
    expect(linkedReference.answer).toContain('The assessment summarizes');
    expect(linkedReference.claims[0].sourceIds).toEqual([source.id]);
  });

  it('allows a qualified package-specific food-choice judgment without lexical medical filtering', () => {
    const answer = 'I would not make this the default daily snack: the ingredient list puts refined wheat flour first, although the package also carries a sugar-free claim.';
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstructionFixture(),
      claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0', 'package-fact:statement:0'] }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [],
      inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], question: 'Should someone choose this as a daily snack?' });

    expect(result.answer).toBe(answer);
    expect(result.claims).toHaveLength(1);
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

  it('drops an unavailable optional package-fact link when a claim has independently validated evidence', () => {
    const reconstruction = { ...reconstructionFixture(), ingredients: [] };
    const answer = 'The OCR line appears to show about 8.8 g of protein.';
    const decisions: Array<{ stage: string; index: number; decision: string; reason?: string }> = [];
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstruction,
      claims: [{
        mode: 'synthesis', text: answer, observationIds: ['ocr-line-1'], sourceIds: [],
        packageFactIds: ['package-fact:ingredient:0'],
      }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], diagnostic: event => decisions.push(event) });

    expect(result.answer).toBe(answer);
    expect(result.claims).toMatchObject([{ observationIds: ['ocr-line-1'], packageFactIds: [] }]);
    expect(decisions).toContainEqual({ stage: 'claim', index: 0, decision: 'accepted', reason: 'unavailable-package-fact-link-dropped' });
  });

  it('does not accept a dangling package-fact link as evidence by itself', () => {
    const reconstruction = { ...reconstructionFixture(), ingredients: [] };
    const answer = 'The ingredient list places refined wheat flour first.';
    const decisions: Array<{ stage: string; index: number; decision: string; reason?: string }> = [];
    const result = validateInferenceOutput({
      answer,
      packageReconstruction: reconstruction,
      claims: [{ mode: 'synthesis', text: answer, observationIds: [], sourceIds: [], packageFactIds: ['package-fact:ingredient:0'] }],
      answerParts: [{ text: answer, claimIndexes: [0] }],
      limitations: [], inspectImage: null,
    }, { package: fixturePackage, images: [{ handle: 'synthetic-image' }], diagnostic: event => decisions.push(event) });

    expect(result.claims).toEqual([]);
    expect(result.answer).not.toContain(answer);
    expect(decisions).toContainEqual({ stage: 'claim', index: 0, decision: 'rejected', reason: 'unknown-evidence-id' });
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
