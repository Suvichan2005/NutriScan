import { describe, expect, it } from 'vitest';
import { packageReconstructionContentSchema, packageSchema } from '../contracts';
import { validateInferenceOutput } from '../../modules/inference/core';
import { evidenceSources } from '../../modules/knowledge';
import { attachGoogleGrounding, compactSavedPackageFacts, compactSavedReconstruction, focusedIngredientRecoverySchema, focusedLabelRecoverySchema, getAgentSystemInstruction, getAgentToolDeclarations, googleGroundingEvidence, mergeFocusedLabelRecovery, normalizeModelImageRegions, normalizeProviderAssistOutput, parseAgentProviderOutput, sanitizeAssistantEvidenceLabels, selectIngredientRecoveryRegion, selectNutritionRecoveryRegion, toolResultForModel } from './gemini';
import { executeGeminiTool } from './gemini-tools';
import { getNutritionGuidance } from './nutrition-guidance';

describe('nutrition guidance retrieval', () => {
  it('returns global guidance for an India-market question without treating US guidance as local', () => {
    const matches = getNutritionGuidance({
      query: 'Is this good to have for diabetic patients daily for snacking?',
      condition: 'diabetes',
      jurisdiction: 'India',
      maxResults: 3,
    });
    expect(matches.map(source => source.id)).toContain('idf-healthy-nutrition-diabetes-2024');
    expect(matches.map(source => source.id)).not.toContain('ada-standards-diabetes-2026-nutrition');
    expect(matches.find(source => source.id === 'idf-healthy-nutrition-diabetes-2024')).toMatchObject({
      jurisdiction: 'Global',
      publishedAt: '2024-08-20',
      limitations: expect.stringContaining('not a clinical practice guideline'),
    });
  });

  it('retrieves carbohydrate-quality guidance when package context makes it relevant', () => {
    const matches = getNutritionGuidance({
      query: 'Refined wheat flour (maida), carbohydrate quality',
      jurisdiction: 'India',
      maxResults: 3,
    });
    expect(matches.map(source => source.id)).toContain('who-carbohydrate-2023');
    expect(matches.find(source => source.id === 'who-carbohydrate-2023')).toMatchObject({
      publisher: 'World Health Organization',
      jurisdiction: expect.stringMatching(/^Global/),
      limitations: expect.stringContaining('not a package-specific threshold'),
    });
  });

  it('retrieves India-specific package RDA references without mixing them with clinical targets', () => {
    const matches = getNutritionGuidance({
      query: 'What does the per-serving %RDA on this Indian nutrition label mean?',
      jurisdiction: 'India',
      maxResults: 5,
    });
    const labelRule = matches.find(source => source.id === 'fssai-labelling-rda-reference-viii-2025');
    expect(labelRule).toMatchObject({
      publisher: 'Food Safety and Standards Authority of India',
      jurisdiction: 'India',
      publishedAt: '2025-09-09',
      summary: expect.stringContaining('2,000 mg sodium'),
      limitations: expect.stringContaining('not a finding that a particular package complies'),
    });
    expect(matches.map(source => source.id)).not.toContain('fssai-labelling-amendment-2026');
    expect(matches.map(source => source.id)).not.toContain('aha-sodium-guidance-2025');
  });

  it('surfaces the future FSSAI RDA exception only for infant-label amendment queries', () => {
    const matches = getNutritionGuidance({
      query: 'What changes for infant nutrition labels under the 2026 FSSAI RDA amendment?',
      jurisdiction: 'India',
      maxResults: 5,
    });
    expect(matches.find(source => source.id === 'fssai-labelling-amendment-2026')).toMatchObject({
      publishedAt: '2026-03-24',
      effectiveAt: '2027-07-01',
      limitations: expect.stringContaining('Do not apply its changes before 1 July 2027'),
    });
  });
});

describe('saved-package follow-up context', () => {
  it('retains the complete saved reconstruction independent of follow-up wording', () => {
    const saved = packageReconstructionContentSchema.parse({
      identity: { brand: 'Example', name: 'Crackers', variant: 'Original', status: 'provisional', evidence: { observationIds: ['identity-line'], imageRegions: [] } },
      serving: { printedText: '2 crackers (13 g)', quantity: 13, unit: 'g', pieceCount: 2, pieceDescription: 'crackers', status: 'provisional', evidence: { observationIds: ['serving-line'], imageRegions: [] } },
      nutritionRows: [{ rowId: 'carb-serving', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '8 g', value: 8, unit: 'g', columnLabel: 'Per serving', basisText: 'per serving', basisAmount: 13, basisUnit: 'g', qualifier: null, status: 'provisional', evidence: { observationIds: ['nutrition-line'], imageRegions: [] } }],
      ingredients: [
        { position: 0, name: 'Wheat flour', printedText: 'WHEAT FLOUR', printedPercentage: null, normalizedName: 'wheat flour', status: 'provisional', evidence: { observationIds: ['ingredient-line'], imageRegions: [] } },
        { position: 1, name: 'Salt', printedText: 'SALT', printedPercentage: null, normalizedName: 'salt', status: 'provisional', evidence: { observationIds: ['ingredient-line'], imageRegions: [] } },
      ],
      additives: [{ printedName: 'Raising agent', code: '500(i)', normalizedName: 'sodium carbonate', status: 'provisional', evidence: { observationIds: ['ingredient-line'], imageRegions: [] } }],
      statements: [{ kind: 'may-contain', label: null, text: 'May contain peanuts', status: 'provisional', evidence: { observationIds: ['allergen-line'], imageRegions: [] } }],
      regions: [{ imageId: 'back', role: 'nutrition-table', region: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 }, observationIds: ['nutrition-line'] }],
      unresolved: [{ field: 'sodium', reason: 'The printed value is not legible.', evidence: { observationIds: ['nutrition-line'], imageRegions: [] } }],
      interpretationNote: 'Saved provisional package interpretation.',
    });
    expect(compactSavedReconstruction(saved)).toEqual(saved);
  });

  it('passes stable package fact identifiers without duplicating their text in follow-up context', () => {
    const facts = [
      { id: 'package-fact:identity', text: 'Example crackers' },
      { id: 'package-fact:serving', text: 'Two crackers, 13 g' },
      { id: 'package-fact:ingredient:0', text: 'Wheat flour' },
      { id: 'package-fact:additive:0', text: 'INS 500(i)' },
      { id: 'package-fact:statement:0', text: 'May contain peanuts' },
    ];
    expect(compactSavedPackageFacts(facts)).toEqual(facts.map(({ id }) => ({ id })));
  });
});
describe('model answer-part recovery', () => {
  it('maps evidenceClaims and claimIds into the shared response contract', () => {
    const output = normalizeProviderAssistOutput({
      answer: 'The label names refined wheat flour.',
      answerParts: [{ body: 'The label names refined wheat flour.', claimIds: ['ingredient-claim'] }],
      evidenceClaims: [{
        claimId: 'ingredient-claim', statement: 'The ingredient list names refined wheat flour.', category: 'package-ingredient',
        observationIds: ['ocr-ingredients'], sourceIds: [], calculationIds: [],
        supportingSpans: [{ kind: 'observation', id: 'ocr-ingredients', quote: 'INGREDIENTS: REFINED WHEAT FLOUR' }],
      }],
    });

    expect(output?.claims).toHaveLength(1);
    expect(output?.claims[0]).toMatchObject({mode:'synthesis',text:'The ingredient list names refined wheat flour.',observationIds:['ocr-ingredients']});
    expect(output?.answerParts).toEqual([{text:'The label names refined wheat flour.',claimIndexes:[0]}]);
    expect(output?.answer).toBe('The label names refined wheat flour.');
  });

  it('adapts the provider package.reconstruction dialect without a second structure-generation pass',()=>{
    const answer='Protein 8 g per 25 g.';
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer,
      claims:[],answerParts:[],limitations:[],inspectImage:null,
      package:{reconstruction:{
        current:true,
        packageFacts:[],
        nutritionRows:[{rowId:'protein-25g',nutrient:'Protein',printedLabel:'Protein',value:8,unit:'g',basis:'Per 25 g',status:'provisional',observationIds:['OBS_1']}],
      }},
      uiComponents:[],
    }),true);
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.output.packageReconstruction?.nutritionRows).toMatchObject([{
      nutrient:'Protein',value:8,unit:'g',basisText:'Per 25 g',basisAmount:25,basisUnit:'g',
    }]);
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answer).toBe(answer);
  });

  it('does not infer answer-part evidence links from matching wording', () => {
    const answer = 'The label names refined wheat flour.';
    const normalized = normalizeProviderAssistOutput({
      answer,
      answerParts: [{ text: answer, claimIndexes: [] }],
      claims: [{ text: answer, observationIds: ['ocr-ingredients'], sourceIds: [] }],
      limitations: [], inspectImage: null,
    });
    const paraphrase = normalizeProviderAssistOutput({
      answer: 'This contains wheat flour.',
      answerParts: [{ text: 'This contains wheat flour.', claimIndexes: [] }],
      claims: [{ text: answer, observationIds: ['ocr-ingredients'], sourceIds: [] }],
      limitations: [], inspectImage: null,
    });

    expect(normalized).toBeNull();
    expect(paraphrase).toBeNull();
  });

  it('does not turn answer-part references into a synthetic claim', () => {
    const answer='For two biscuits (approximately 13.4 g), provisional carbohydrate is about 9.28 g.';
    const output=normalizeProviderAssistOutput({
      answerParts:[{body:answer,calculationIds:['CALC_1'],interpretationRowIds:['ROW_1']}],
      uiComponents:[],
    });

    expect(output).toBeNull();
    expect(parseAgentProviderOutput(JSON.stringify({answer,claims:[],answerParts:[],limitations:[],inspectImage:null})).modelOutputStatus).toBe('no-grounded-claims');
  });

  it('does not synthesize a claim from a package-fact citation on an answer part',()=>{
    const answer='The package appears to list refined wheat flour first.';
    const output=normalizeProviderAssistOutput({
      answer,
      answerParts:[{body:answer,package_fact_ids:['package-fact:ingredient:0']}],
      limitations:[],inspectImage:null,
    });

    expect(output).toBeNull();
  });

  it('does not manufacture an answer claim beside an unrelated model claim',()=>{
    const answer='For two biscuits (approximately 13.4 g), provisional carbohydrate is about 9.3 g.';
    const output=normalizeProviderAssistOutput({
      answer,
      answerParts:[],
      claims:[{mode:'synthesis',text:'An unrelated serving statement.',observationIds:['OBS_I'],sourceIds:[],calculationIds:[],interpretationRowIds:[],profileFieldIds:[]}],
      limitations:[],inspectImage:null,
    });

    expect(output?.claims).toHaveLength(1);
    expect(output?.claims[0]).toMatchObject({text:'An unrelated serving statement.',observationIds:['OBS_I']});
    expect(output?.answerParts).toEqual([]);
    expect(output?.answer).toBe(answer);
  });

  it('resolves alternate claimIds that actually name cited evidence aliases',()=>{
    const answer='Two biscuits (about 13.4 g) provide 9.28 g carbohydrate and 0 g added sugars.';
    const output=normalizeProviderAssistOutput({
      answer,
      answerParts:[{text:answer,claimIds:['CL_1','CL_2']}],
      claims:[
        {claimId:'CL_1',category:'nutrition',text:'Two biscuits provide about 9.28 g carbohydrate.',observationIds:['OBS_K'],sourceIds:[],calculationIds:['CALC_1'],interpretationRowIds:['ROW_1']},
        {claimId:'CL_2',category:'nutrition',text:'Two biscuits provide 0 g added sugars.',observationIds:['OBS_M'],sourceIds:[],calculationIds:['CALC_2'],interpretationRowIds:['ROW_2']},
      ],
    });

    expect(output?.answerParts).toEqual([{text:answer,claimIndexes:[0,1]}]);
  });

  it('normalizes the provider fact/type response dialect without a repair call',()=>{
    const answer='Two biscuits provide approximately 9.3 g of carbohydrates.';
    const output=normalizeProviderAssistOutput({
      answer,
      answerParts:[{text:answer,type:'conclusion',claimIds:['CLM_1']}],
      claims:[{id:'CLM_1',type:'calculated',fact:'Two biscuits provide approximately 9.28 g of carbohydrates.',observationIds:['OBS_K'],sourceIds:[],calculationIds:['CALC_1'],interpretationRowIds:['ROW_1'],profileFieldIds:[],supportingSpans:[]}],
      ocrWordEvidence:[{region:'nutrition',wordIndexes:[1,2,3]}],
      tentativeCandidates:[],
      packageReconstruction:{unexpected:'follow-ups must not replace the saved package'},
    },false);

    expect(output?.answer).toBe(answer);
    expect(output?.claims).toMatchObject([{mode:'synthesis',text:'Two biscuits provide approximately 9.28 g of carbohydrates.',calculationIds:['CALC_1']}]);
    expect(output?.answerParts).toEqual([{text:answer,claimIndexes:[0]}]);
    expect(output).not.toHaveProperty('packageReconstruction');
  });

  it('preserves invalid answer-part indexes for claim-reference validation', () => {
    const output=normalizeProviderAssistOutput({
      answer:'A supported label statement.',
      answerParts:[{text:'A supported label statement.',claimIndexes:[20]}],
      claims:[{
        mode:'synthesis',text:'The ingredient list names refined wheat flour.',
        observationIds:['ocr-ingredients'],sourceIds:[],calculationIds:[],profileFieldIds:[],
        supportingSpans:[{kind:'observation',id:'ocr-ingredients',quote:'INGREDIENTS: REFINED WHEAT FLOUR'}],
        visualEvidence:[],
      }],
      limitations:[],inspectImage:null,
    });

    expect(output?.answer).toBe('A supported label statement.');
    expect(output?.answerParts).toEqual([{text:'A supported label statement.',claimIndexes:[20]}]);
    expect(output?.claims).toHaveLength(1);
  });

  it('retains schema-valid empty evidence output for the caller to classify as unsupported quality', () => {
    const output = normalizeProviderAssistOutput({ answer: 'Unsupported prose.', answerParts:[], claims: [], limitations: [], inspectImage: null });
    expect(output?.claims).toEqual([]);
    expect(output?.answerParts).toEqual([]);
  });
});

describe('provider package-reconstruction normalization',()=>{
  it('unwraps one structured provider envelope and ignores transport-only root metadata without losing reconstruction',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'',
    };
    const parsed=parseAgentProviderOutput(JSON.stringify({
      output:{answer:'The label reading is provisional.',answerParts:[],claims:[],packageReconstruction:reconstruction,limitations:[],inspectImage:null},
      transportMetadata:{attempt:1},
    }),true);
    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.output.packageReconstruction?.identity.brand).toBe('Bisk Farm');
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answer).toBe('The label reading is provisional.');
    expect(JSON.stringify(parsed.output)).not.toContain('transportMetadata');
  });

  it('classifies a provider answer with global evidence but no claim links as an ungrounded answer, not a schema failure',()=>{
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer:'A study reports an effect, but the package does not show a dose.',
      answerParts:[],claims:[],
      evidence:[{sourceId:'SRC_1',title:'A study',summary:'A scoped finding.',limitations:'Not package-specific.'}],
      packageFacts:[{id:'package-fact:ingredient:0',text:'Ingredient 1: oats.'}],
      limitations:[],inspectImage:null,providerMetadata:{finish:'stop'},
    }));
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answer).toBe('A study reports an effect, but the package does not show a dose.');
    expect(parsed.output.answerParts).toEqual([]);
  });

  it('continues rejecting malformed claim data instead of converting it into an empty claim set',()=>{
    expect(()=>parseAgentProviderOutput(JSON.stringify({answer:'A claim.',claims:'not-an-array',limitations:[],inspectImage:null})))
      .toThrowError(expect.objectContaining({code:'provider_schema_invalid'}));
  });

  it('preserves grounded reconstruction entries when Gemini uses equivalent field names or adds shape-only keys',()=>{
    const output=normalizeProviderAssistOutput({
      answer:'The package appears to be a Bisk Farm cream cracker.',
      answerParts:[{text:'The package appears to be a Bisk Farm cream cracker.',claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:'The package appears to be a Bisk Farm cream cracker.',observation_ids:['OBS_1'],source_ids:[],supporting_spans:[],visual_evidence:[]}],
      package_reconstruction:{
        product_identity:{brand_name:'Bisk Farm',product_name:'Cream Cracker',confidence:'high',source_evidence:{observation_ids:['OBS_1']},extra:'ignored structural metadata'},
        serving_size:{text:'2 biscuits, approximately 13.4 g',amount:'13.4',unit:'g',count:2,pieces:'biscuits',observation_ids:['OBS_2']},
        nutrition_table:[{name:'Carbohydrates',printed_value:'69.29',value:'69.29',unit:'g',column:'Per 100 g',basis_amount:'100',basis_unit:'g',observation_ids:['OBS_3'],extra:'ignored structural metadata'}],
        ingredients:[{text:'Refined wheat flour (maida) (89.98%)',normalized_name:'Refined wheat flour',printed_percentage:'89.98',image_id:'IMG_2',status:'supported',extra:'ignored structural metadata'}],
        claims_and_warnings:[{type:'claim',statement:'No added sugar',image_id:'IMG_1'}],
        unknowns:[],note:'Interpretation remains provisional.',extra:'ignored reconstruction metadata',
      },
      limitations:[],inspectImage:null,
    },true);

    expect(output?.packageReconstruction).toMatchObject({
      identity:{brand:'Bisk Farm',name:'Cream Cracker',status:'provisional',evidence:{observationIds:['OBS_1']}},
      serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['OBS_2']}},
      nutritionRows:[{rowId:'nutrition-1',nutrient:'Carbohydrates',printedValue:'69.29',value:69.29,unit:'g',columnLabel:'Per 100 g',basisAmount:100,basisUnit:'g',status:'provisional',evidence:{observationIds:['OBS_3']}}],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'Refined wheat flour (maida) (89.98%)',printedPercentage:89.98,status:'provisional',evidence:{imageRegions:[{imageId:'IMG_2',region:null}]}}],
      statements:[{kind:'claim',text:'No added sugar',status:'provisional',evidence:{imageRegions:[{imageId:'IMG_1',region:null}]}}],
      interpretationNote:'Interpretation remains provisional.',
    });
    expect(JSON.stringify(output)).not.toContain('ignored structural metadata');
  });

  it('normalizes the model package dialect without fabricating answer claims or requiring a structure-repair call',()=>{
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer:'The package reading is provisional.',
      answerParts:[],
      claims:[],
      uiComponents:[],
      package:{
        current:true,
        identity:{brand:'Bisk Farm',productName:'Cream Cracker Sugar Free',variant:'Sugar Free'},
        serving:{statement:'2 biscuits (approx. 13.4 g)',size:'13.4',unit:'g',observationIds:['OBS_SERVING']},
        nutritionRows:[{rowId:'row_carbs_serving',nutrient:'carbohydrate',printedValue:'9.28',value:9.28,unit:'g',columnLabel:'Per serving',basisText:'Per serving',basisAmount:13.4,basisUnit:'g',status:'provisional',observationIds:['OBS_CARBS']}],
        ingredients:[{ingredientId:'ingredient-1',printedLabel:'Refined wheat flour (maida) (89.98%)',normalizedName:'refined wheat flour',percentage:89.98,observationIds:['OBS_INGREDIENT']}],
        claims:[{claimId:'claim-1',type:'claim',printedText:'No added sugars',observationIds:['OBS_CLAIM']}],
        warnings:[],certifications:[],packageFacts:[],
      },
    }),true);

    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answer).toBe('The package reading is provisional.');
    expect(parsed.output.packageReconstruction).toMatchObject({
      identity:{brand:'Bisk Farm',name:'Cream Cracker Sugar Free'},
      serving:{printedText:'2 biscuits (approx. 13.4 g)',quantity:13.4,unit:'g'},
      nutritionRows:[{rowId:'row_carbs_serving',value:9.28,unit:'g',basisAmount:13.4,basisUnit:'g',evidence:{observationIds:['OBS_CARBS']}}],
      ingredients:[{name:'refined wheat flour',printedPercentage:89.98,evidence:{observationIds:['OBS_INGREDIENT']}}],
      statements:[{kind:'claim',text:'No added sugars',evidence:{observationIds:['OBS_CLAIM']}}],
    });
  });

  it('keeps categorized packageFacts separate from explicitly linked conversational claims',()=>{
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer:'The label lists the product and serving declaration.',
      answerParts:[{text:'The label lists the product and serving declaration.',claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:'The product name is shown on the package.',observationIds:['OBS_IDENTITY'],sourceIds:[]}],
      packageReconstruction:{
        current:true,
        packageFacts:[
          {factId:'package-fact:identity',category:'identity',printedLabel:'Product name',printedValue:'Millet Noodles',normalizedName:'Millet noodles',status:'provisional',observationIds:['OBS_IDENTITY']},
          {factId:'package-fact:serving',category:'serving',printedLabel:'Serving Size',printedValue:'2 biscuits (approximately 70 g)',status:'clear',observationIds:['OBS_SERVING']},
          {factId:'package-fact:nutrition',category:'nutrition-row',printedLabel:'Protein',printedValue:'10 g',basisText:'Per 100 g',status:'provisional',observationIds:['OBS_NUTRITION']},
          {factId:'package-fact:ingredient-1',category:'ingredient',printedLabel:'Ingredient',printedValue:'Whole wheat flour',normalizedName:'whole wheat flour',status:'provisional',observationIds:['OBS_INGREDIENT']},
          {factId:'package-fact:additive-1',category:'additive',printedLabel:'INS 330',printedValue:'Citric acid',code:'330',normalizedName:'citric acid',status:'provisional',observationIds:['OBS_ADDITIVE']},
          {factId:'package-fact:allergen',category:'allergen',printedLabel:'Allergen note',printedValue:'Contains Milk',status:'provisional',observationIds:['OBS_ALLERGEN']},
        ],
        nutritionRows:[],
      },
      limitations:[],inspectImage:null,
    }),true);

    expect(parsed.output.claims).toMatchObject([{text:'The product name is shown on the package.',observationIds:['OBS_IDENTITY']}]);
    expect(parsed.output.packageReconstruction).toMatchObject({
      identity:{name:'Millet noodles',status:'provisional',evidence:{observationIds:['OBS_IDENTITY']}},
      serving:{printedText:'2 biscuits (approximately 70 g)',quantity:70,unit:'g',status:'clear',evidence:{observationIds:['OBS_SERVING']}},
      nutritionRows:[{nutrient:'Protein',printedValue:'10 g',value:10,unit:'g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g',evidence:{observationIds:['OBS_NUTRITION']}}],
      ingredients:[{name:'whole wheat flour',printedText:'Whole wheat flour',evidence:{observationIds:['OBS_INGREDIENT']}}],
      additives:[{printedName:'Citric acid',code:'330',normalizedName:'citric acid',evidence:{observationIds:['OBS_ADDITIVE']} }],
      statements:[{kind:'contains',label:'Allergen note',text:'Contains Milk',evidence:{observationIds:['OBS_ALLERGEN']}}],
    });
  });

  it('withholds an unlinked provider table summary instead of manufacturing row claims',()=>{
    const answer='The nutrition table lists energy and protein per 100 g. It reports sodium 999 mg per 100 g.';
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer,
      answerParts:[],
      claims:[],
      packageReconstruction:{
        current:true,
        nutritionRows:[
          {rowId:'energy-100g',nutrient:'Energy',printedLabel:'Energy',printedValue:'384 kcal',value:384,unit:'kcal',columnLabel:'Per 100 g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g',status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
          {rowId:'protein-100g',nutrient:'Protein',printedLabel:'Protein',printedValue:'8.2 g',value:8.2,unit:'g',columnLabel:'Per 100 g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g',status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
        ],
        packageFacts:[],
      },
    }),true);
    const decisions:unknown[]=[];
    const result=validateInferenceOutput(parsed.output,{
      package:packageSchema.parse({id:'provider-dialect-test',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:true,createdAt:'2026-10-24T00:00:00.000Z'}),
      images:[{handle:'synthetic-image'}],question:'Summarize the readable nutrition table.',diagnostic:event=>decisions.push(event),
    });

    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(result.claims).toEqual([]);
    expect(decisions).not.toContainEqual(expect.objectContaining({stage:'claim',reason:'no-evidence-reference'}));
  });

  it('classifies an explicit claimless table response without inventing row statements',()=>{
    const answer='The label declares a serving size of 35 g and lists amounts per serving: Energy 139 kcal, Protein 5 g, Sodium 999 mg.';
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer,
      answerParts:[],claims:[],
      packageReconstruction:{
        current:true,
        serving:{printedText:'Serving size 35 g',quantity:35,unit:'g',pieceCount:null,pieceDescription:null,status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
        nutritionRows:[
          {rowId:'energy-35g',nutrient:'Energy',printedLabel:'Energy',printedValue:'139 kcal',value:139,unit:'kcal',basisText:'Per serving',basisAmount:35,basisUnit:'g',status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
          {rowId:'protein-35g',nutrient:'Protein',printedLabel:'Protein',printedValue:'5 g',value:5,unit:'g',basisText:'Per serving',basisAmount:35,basisUnit:'g',status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
          {rowId:'sodium-35g',nutrient:'Sodium',printedLabel:'Sodium',printedValue:'170 mg',value:170,unit:'mg',basisText:'Per serving',basisAmount:35,basisUnit:'g',status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'synthetic-image',region:null}]}},
        ],
      },
      limitations:[],inspectImage:null,
    }),true);
    expect(parsed.schemaMode).toBe('provider-schema');
    expect(parsed.modelOutputStatus).toBe('no-grounded-claims');
    expect(parsed.output.claims).toEqual([]);
    expect(parsed.output.answer).toBe(answer);

    const question='Show the nutrition values for the serving.';
    const result=validateInferenceOutput(parsed.output,{
      package:packageSchema.parse({id:'atomic-row-adapter',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],observations:[],rawText:'',warnings:[],synthetic:true,createdAt:'2026-10-24T00:00:00.000Z'}),
      images:[{handle:'synthetic-image'}],question,
    });
    expect(result.claims).toEqual([]);
    expect(result.answer).toContain('can’t establish a reliable answer');
    expect(result.answer).not.toContain('Energy 139 kcal');
    expect(result.answer).not.toContain('999');
  });

  it('does not manufacture evidence links or confidence for a numeric row with no provenance',()=>{
    const output=normalizeProviderAssistOutput({
      answer:'The nutrition amount is unresolved.',answerParts:[{text:'The nutrition amount is unresolved.',claimIndexes:[0]}],
      claims:[{mode:'synthesis',text:'The nutrition amount is unresolved.',observationIds:['OBS_1'],sourceIds:[]}],
      packageReconstruction:{
        identity:{brand:null,name:null,variant:null,evidence:{}},serving:null,
        nutritionRows:[{nutrient:'Sodium',printedValue:'240',value:240,unit:'mg'}],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],
      },limitations:[],inspectImage:null,
    },true);
    expect(output?.packageReconstruction?.nutritionRows).toEqual([expect.objectContaining({
      nutrient:'Sodium',value:240,status:'unreadable',evidence:{observationIds:[],imageRegions:[]},
    })]);
  });
});

describe('legacy JSON adapter is offline-only', () => {
  it('keeps no grounded claims, invalid JSON and schema failure as distinct outcomes', () => {
    const noClaims = parseAgentProviderOutput(JSON.stringify({ answer: 'Text without linked claims.', answerParts:[], claims: [], limitations: [], inspectImage: null }));
    let malformedJsonError: unknown;
    try { parseAgentProviderOutput('{not json'); } catch (error) { malformedJsonError = error; }
    let schemaError: unknown;
    try { parseAgentProviderOutput(JSON.stringify({ answer: 'bad schema', claims: 'not an array', limitations: [], inspectImage: null })); } catch (error) { schemaError = error; }

    expect(noClaims.modelOutputStatus).toBe('no-grounded-claims');
    expect(noClaims.output.claims).toEqual([]);
    expect(noClaims.output.answer).toBe('Text without linked claims.');
    expect(malformedJsonError).toMatchObject({ code: 'provider_invalid_json', status: 502 });
    expect(schemaError).toMatchObject({ code: 'provider_schema_invalid', status: 502 });
  });

  it('reports schema failure paths without copying model values into diagnostics', () => {
    let failure: unknown;
    try { parseAgentProviderOutput(JSON.stringify({ answer: 'PRIVATE LABEL NUMBER', claims: 'bad', limitations: [], inspectImage: null })); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'provider_schema_invalid', issuePaths: expect.arrayContaining(['claims']) });
    expect(JSON.stringify(failure)).not.toContain('PRIVATE LABEL NUMBER');
  });
});

describe('natural NutriScan agent contract', () => {
  it('uses one concise natural-answer instruction and exposes operation tools rather than a UI catalog', () => {
    const instruction = getAgentSystemInstruction();
    const tools = getAgentToolDeclarations(false, false);
    expect(instruction).toContain('answer in plain text');
    expect(instruction).toContain('cite the exact SRC handle and source name/date');
    expect(instruction).toContain('double-quoted exact excerpt (24–300 characters)');
    expect(instruction).toContain('Omit source-dependent claims when no exact excerpt is available');
    expect(instruction).toContain('Keep official claim rules separate from evidence of effects');
    expect(instruction).toContain('disclose missing source classes rather than filling them from memory');
    expect(instruction).toContain('state judgment first');
    expect(instruction).toContain('For health-specific suitability, retrieve the narrowest relevant guidance or research');
    expect(instruction).toContain('a condition mention alone does not justify lookup');
    expect(instruction).toContain('Use a matching printed row or supplied typed calculation for quantities');
    expect(instruction).toContain('call the appropriate calculator when needed and never calculate in prose');
    expect(instruction.length).toBeLessThan(2_000);
    expect(tools.map(tool => tool.name)).toContain('calculate_nutrition');
    expect(tools.find(tool => tool.name === 'calculate_nutrition')?.description).toContain('do not repeat those calculations');
    expect(tools.find(tool => tool.name === 'calculate_nutrition')?.description).toContain('Calculate only nutrients the user asks about or that are necessary to answer the request; do not calculate other package rows just to populate UI');
    expect(tools.find(tool => tool.name === 'calculate_nutrition')?.description).toContain('calculate each requested nutrient for the absolute portion difference as its own direct amount');
    expect(tools.find(tool => tool.name === 'search_knowledge')?.description).toContain('Use for explicit research/source requests');
    expect(JSON.stringify(tools.find(tool => tool.name === 'get_nutrition_guidance'))).toContain('Omit unrelated package details');
    expect(tools.find(tool => tool.name === 'get_nutrition_guidance')?.description).toContain('Use when the user explicitly asks for nutrition guidance/recommendations or your answer needs contextual dietary guidance beyond package arithmetic');
    expect(tools.find(tool => tool.name === 'get_nutrition_guidance')?.description).toContain('if no applicable record is returned, disclose that rather than inventing guidance');
    expect(tools.map(tool => tool.name)).not.toContain('show_nutrition_table');
  });
});

describe('Gemini tool citation feedback', () => {
  it('returns the exact bounded evidence summary that final citation validation checks', () => {
    const source = evidenceSources.find(item => item.id === 'who-sugars-2015')!;
    const result = toolResultForModel({ status: 'ok', resultCount: 1 }, [source]);
    const citation = (result.citationEvidence as Array<Record<string, unknown>>)[0];

    expect(citation).toMatchObject({
      sourceId: source.id,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      summary: source.summary,
      limitations: source.limitations,
    });
    expect(source.summary.includes(String(citation.summary))).toBe(true);
    expect((toolResultForModel({ status: 'empty' }).citationEvidence)).toBeUndefined();
  });

  it('bounds each tool response to five citations and validator-safe field lengths', () => {
    const sources = Array.from({ length: 6 }, (_, index) => ({
      ...evidenceSources[0],
      id: `source-${index}`,
      title: 't'.repeat(300),
      publisher: 'p'.repeat(200),
      url: `https://example.org/${index}`,
      jurisdiction: 'j'.repeat(250),
      summary: 's'.repeat(2000),
      limitations: 'l'.repeat(700),
    }));
    const result = toolResultForModel({}, sources);
    const citations = result.citationEvidence as Array<Record<string, unknown>>;

    expect(citations).toHaveLength(5);
    expect(citations[0].title).toHaveLength(240);
    expect(citations[0].publisher).toHaveLength(160);
    expect(citations[0].summary).toHaveLength(1200);
    expect(citations[0].limitations).toHaveLength(500);
  });
});

describe('Google Search grounding evidence', () => {
  const segment = 'EFSA reported high-level exposure estimates above the ADI for toddlers and children when using maximum permitted levels.';
  const metadata = {
    webSearchQueries: ['EFSA TBHQ refined exposure assessment'],
    groundingChunks: [
      { web: { uri: 'https://www.efsa.europa.eu/en/efsajournal/pub/4363', title: 'EFSA refined exposure assessment' } },
      { web: { uri: 'http://example.org/insecure', title: 'Insecure page' } },
      { web: { uri: 'https://localhost/private', title: 'Local page' } },
    ],
    groundingSupports: [
      { segment: { text: segment }, groundingChunkIndices: [0] },
      { segment: { text: segment }, groundingChunkIndices: [1, 2] },
    ],
  } as const;

  it('keeps only secure public web citations and labels generated text separately from source text', () => {
    const evidence = googleGroundingEvidence(metadata as never);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      title: 'EFSA refined exposure assessment',
      publisher: 'Google Search grounding via Gemini',
      category: 'web-search',
      url: 'https://www.efsa.europa.eu/en/efsajournal/pub/4363',
      summary: segment,
    });
    expect(evidence[0].limitations).toMatch(/not a quotation or text fetched and independently reviewed/i);
  });

  it('attaches only an exact provider-grounded segment that matches a claim', () => {
    const [source] = googleGroundingEvidence(metadata as never);
    const output = {
      answer: 'EFSA reported exposure estimates above the ADI for some children under maximum-use assumptions.',
      claims: [{
        mode: 'synthesis',
        text: segment,
        observationIds: [],
        sourceIds: [],
        supportingSpans: [],
      }],
      limitations: [],
      inspectImage: null,
    };
    const result = attachGoogleGrounding(output, [source]) as typeof output;
    expect(result.claims[0].sourceIds).toEqual([source.id]);
    expect(result.claims[0].supportingSpans).toEqual([{ kind: 'source', id: source.id, quote: source.summary }]);
  });

  it('cleans JSON-encoded response segments before exposing them as generated-grounded evidence', () => {
    const encodedSegment = '"text": "Under refined dietary exposure scenarios, EFSA concluded the ADI was not exceeded in any population group."';
    const [source] = googleGroundingEvidence({
      groundingChunks: [{ web: { uri: 'https://www.efsa.europa.eu/en/efsajournal/pub/4363', title: 'EFSA Journal 4363' } }],
      groundingSupports: [{ segment: { text: encodedSegment }, groundingChunkIndices: [0] }],
    } as never);
    expect(source.summary).toBe('Under refined dietary exposure scenarios, EFSA concluded the ADI was not exceeded in any population group.');
  });

  it('does not attach a weakly related source or a source missing numeric support', () => {
    const [source] = googleGroundingEvidence({
      ...metadata,
      groundingSupports: [{ segment: { text: 'EFSA reported an ADI value of 0.7 mg/kg body weight for TBHQ.' }, groundingChunkIndices: [0] }],
    } as never);
    const output = {
      answer: 'This product contains 12 mg of the substance.',
      claims: [{ mode: 'synthesis', text: 'This product contains 12 mg of the substance.', observationIds: [], sourceIds: [], supportingSpans: [] }],
      limitations: [], inspectImage: null,
    };
    const result = attachGoogleGrounding(output, [source]) as typeof output;
    expect(result.claims[0].sourceIds).toEqual([]);
    expect(result.claims[0].supportingSpans).toEqual([]);
  });
});

describe('Gemini visual-region normalization', () => {
  it('withholds coordinates outside the normalized image while keeping the linked text tentative', () => {
    const input = {
      answer: 'An image-linked reading remains unverified.',
      claims: [{
        mode: 'synthesis', text: 'The package may say cream crackers.', observationIds: [], sourceIds: [], supportingSpans: [],
        visualEvidence: [{ imageId: 'side-1', visibleText: 'CREAM CRACKER', region: { x: 18, y: 22, width: 64, height: 35 } }],
      }],
      tentativeCandidates: [{
        candidateId: 'candidate-1', kind: 'product-identity', field: 'product', proposedValue: 'Cream cracker', numericValue: null,
        unit: null, basis: null, normalizedEntity: null, status: 'tentative', observationIds: [], sourceIds: [], supportingSpans: [],
        visualEvidence: [{ imageId: 'side-1', visibleText: 'CREAM CRACKER', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }], uncertainty: 'Image text is unverified.',
      }],
      limitations: [], inspectImage: null,
    };
    const result = normalizeModelImageRegions(input) as { output: typeof input; discardedRegionCount: number };
    expect(result.discardedRegionCount).toBe(1);
    expect(result.output.claims[0].visualEvidence[0]).toEqual({ imageId: 'side-1', visibleText: 'CREAM CRACKER', region: null });
    expect(result.output.tentativeCandidates[0].visualEvidence?.[0].region).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  });

  it('does not alter unrelated model output or already-withheld image regions', () => {
    const input = {
      answer: 'No image location was established.',
      claims: [{ mode: 'synthesis', text: 'The visible text is tentative.', observationIds: [], sourceIds: [], supportingSpans: [], visualEvidence: [{ imageId: 'side-1', visibleText: 'TEXT', region: null }] }],
      limitations: ['Unverified.'], inspectImage: null,
    };
    const result = normalizeModelImageRegions(input);
    expect(result.discardedRegionCount).toBe(0);
    expect(result.output).toEqual(input);
  });
});

describe('focused nutrition-region recovery',()=>{
  const crop={x:0.08,y:0.12,width:0.42,height:0.58};
  const image={imageId:'back-1',mimeType:'image/jpeg' as const,base64:'aGVsbG8=',side:'back' as const,sourceImage:{width:900,height:363},preprocessing:{rotation:0 as const,contrast:false,invert:false,crop:null}};
  const base=packageReconstructionContentSchema.parse({
    identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
    serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
    nutritionRows:[{rowId:'carb-serving',nutrient:'Carbohydrates',nutrientKey:'carbohydrate',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}}],
    ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:[],imageRegions:[]}}],
    additives:[],statements:[],regions:[{imageId:'back-1',role:'nutrition-table',region:crop,observationIds:[]}],unresolved:[],interpretationNote:'Initial interpretation.',
  });

  it('selects one adequate model-located crop only when the nutrition table is sparse and the original photo is attached',()=>{
    expect(selectNutritionRecoveryRegion(base,[image])).toMatchObject({image:{imageId:'back-1'},region:{region:crop}});
    const adequate={...base,nutritionRows:['Energy','Carbohydrates','Added Sugars','Total Sugars','Protein','Total Fat'].map((nutrient,index)=>({...base.nutritionRows[0],rowId:`adequate-${index}`,nutrient,value:index+1,printedValue:`${index+1} g`}))};
    expect(selectNutritionRecoveryRegion(adequate,[image])).toBeNull();
    expect(selectNutritionRecoveryRegion(base,[])).toBeNull();
    expect(selectNutritionRecoveryRegion(base,[image],new Set(['back-1']))).toBeNull();
    expect(selectNutritionRecoveryRegion({...base,regions:[{...base.regions[0],region:{x:0.1,y:0.1,width:0.02,height:0.02}}]},[image])).toBeNull();
  });

  it('triggers recovery from distinct-field coverage rather than raw row count',()=>{
    const names=['Carbohydrates','Added Sugars','Total Sugars','Protein','Total Fat','Carbohydrates'];
    const sparse={...base,serving:null,regions:[base.regions[0]],nutritionRows:names.map((nutrient,index)=>({...base.nutritionRows[0],rowId:`row-${index}`,nutrient,value:index+1,printedValue:`${index+1} g`}))};
    expect(selectNutritionRecoveryRegion(sparse,[image])).toMatchObject({source:'model-located-region'});
    const broad={...sparse,serving:base.serving,nutritionRows:['Energy','Carbohydrates','Added Sugars','Total Sugars','Protein','Total Fat'].map((nutrient,index)=>({...base.nutritionRows[0],rowId:`broad-${index}`,nutrient,value:index+1,printedValue:`${index+1} g`}))};
    expect(selectNutritionRecoveryRegion(broad,[image])).toBeNull();
  });

  it('reuses an already attached OCR geometry crop when the reconstruction omitted its region',()=>{
    const attachedCrop={...image,regionRole:'nutrition-table' as const,preprocessing:{...image.preprocessing,crop:{x:0.08,y:0.12,width:0.42,height:0.58}}};
    const withoutModelRegion={...base,regions:[]};
    expect(selectNutritionRecoveryRegion(withoutModelRegion,[image,attachedCrop])).toMatchObject({source:'attached-ocr-crop',image:{regionRole:'nutrition-table'},region:{region:crop}});
    expect(selectNutritionRecoveryRegion(withoutModelRegion,[image,{...attachedCrop,regionRole:'ingredients'}])).toBeNull();
  });

  it('selects the separate ingredient crop when OCR indicates a partial multi-item list',()=>{
    const ingredientsCrop={...image,regionRole:'ingredients' as const,preprocessing:{...image.preprocessing,crop:{x:0.42,y:0.08,width:0.52,height:0.58}}};
    const observations=[{id:'ingredient-line',field:'ocr-line',text:'INGREDIENTS: FLOUR, OIL, SALT, STARCH, WHEY, YEAST',side:'back' as const,confidence:82,origin:'ocr' as const,imageId:'back-1'}];
    expect(selectIngredientRecoveryRegion(base,[ingredientsCrop],observations)).toMatchObject({
      source:'attached-ingredients-crop',declarationCharacterCount:37,image:{regionRole:'ingredients'},region:{role:'ingredients'},
    });
    expect(selectIngredientRecoveryRegion(base,[ingredientsCrop],[{...observations[0],text:'NUTRITONAL INFORLATION INGREDIENTS:REFINED WHEAT FLOUR MAIOA) (89.98X HYDROGENATED VEGETABLE OIL'}])).toMatchObject({
      source:'attached-ingredients-crop',declarationCharacterCount:expect.any(Number),
    });
    expect(selectIngredientRecoveryRegion({...base,ingredients:[...base.ingredients,{...base.ingredients[0],position:1,name:'Oil'}]},[ingredientsCrop],observations)).toBeNull();
    expect(selectIngredientRecoveryRegion(base,[image],observations)).toBeNull();
    expect(selectIngredientRecoveryRegion(base,[ingredientsCrop],[{...observations[0],text:'PACKED BY EXAMPLE FOODS'}])).toBeNull();
  });

  it('merges ingredient-only recovery without replacing nutrition or dropping image lineage',()=>{
    const ingredientsCrop={x:0.42,y:0.08,width:0.52,height:0.58};
    const recovered=focusedIngredientRecoverySchema.parse({
      ingredients:[{position:1,name:'Vegetable oil',printedText:'HYDROGENATED VEGETABLE OIL',printedPercentage:null,normalizedName:'vegetable oil',status:'provisional',evidence:{observationIds:['ingredient-line']}}],
      additives:[{printedName:'antioxidant',code:'319',normalizedName:null,status:'provisional',evidence:{observationIds:['ingredient-line']}}],
      statements:[{kind:'claim',label:null,text:'No added sugar',status:'provisional',evidence:{observationIds:['ingredient-line']}}],
    });
    const merged=mergeFocusedLabelRecovery(base,recovered,'back-1',ingredientsCrop,new Set(['ingredient-line']));
    expect(merged.nutritionRows).toEqual(base.nutritionRows);
    expect(merged.ingredients.map(item=>item.name)).toEqual(['Refined wheat flour','Vegetable oil']);
    expect(merged.ingredients[1].status).toBe('provisional');
    expect(merged.ingredients[1].evidence.imageRegions).toEqual([{imageId:'back-1',region:ingredientsCrop}]);
    expect(merged.additives.map(item=>item.code)).toEqual(['319']);
    expect(merged.statements.map(item=>item.text)).toEqual(['No added sugar']);
  });

  it('never sends an ingredients-only crop to nutrition recovery when both package sections are incomplete',()=>{
    const nutritionCrop={...image,regionRole:'nutrition-table' as const,preprocessing:{...image.preprocessing,crop:{x:0.08,y:0.08,width:0.36,height:0.48}}};
    const ingredientsCrop={...image,regionRole:'ingredients' as const,preprocessing:{...image.preprocessing,crop:{x:0.4,y:0.08,width:0.5,height:0.48}}};
    const incomplete={...base,regions:[],ingredients:[]};
    expect(selectNutritionRecoveryRegion(incomplete,[image,ingredientsCrop,nutritionCrop])).toMatchObject({
      source:'attached-ocr-crop',image:{regionRole:'nutrition-table'},region:{role:'nutrition-table'},
    });
    expect(selectNutritionRecoveryRegion(incomplete,[image,ingredientsCrop])).toBeNull();

    const adequateRows=['Energy','Carbohydrates','Added Sugars','Total Sugars','Protein','Total Fat'].map((nutrient,index)=>({...base.nutritionRows[0],rowId:`nutrition-${index}`,nutrient,value:index+1,printedValue:`${index+1} g`}));
    expect(selectNutritionRecoveryRegion({...incomplete,nutritionRows:adequateRows,serving:base.serving},[image,ingredientsCrop])).toMatchObject({
      source:'attached-ingredients-crop',image:{regionRole:'ingredients'},region:{role:'ingredients'},
    });
  });

  it('reuses a generic OCR-selected detail crop only when that photo has nutrition cues',()=>{
    const detailCrop={...image,regionRole:'other' as const,preprocessing:{...image.preprocessing,crop}};
    const withoutModelRegion={...base,regions:[]};
    const observations=[{id:'line-1',field:'ocr-line',text:'NUTRITIONAL INFORMATION CARBOHYDRATES 69.29 g',side:'back' as const,confidence:82,origin:'ocr' as const,imageId:'back-1',readingOrder:{runId:'run-1',blockIndex:0,paragraphIndex:0,lineIndex:0}}];
    expect(selectNutritionRecoveryRegion(withoutModelRegion,[image,detailCrop],new Set(),observations)).toMatchObject({source:'attached-label-detail-crop',image:{regionRole:'other'},region:{role:'other',region:crop}});
    expect(selectNutritionRecoveryRegion(withoutModelRegion,[image,detailCrop])).toBeNull();
    expect(selectNutritionRecoveryRegion(withoutModelRegion,[image,detailCrop],new Set(['back-1']),observations)).toBeNull();
  });

  it('reuses an OCR-geometry label-detail crop when recognition text is unreadable and package sections are missing',()=>{
    const labelDetail={...image,regionRole:'label-detail' as const,preprocessing:{...image.preprocessing,crop}};
    const incomplete={...base,regions:[],ingredients:[]};
    expect(selectNutritionRecoveryRegion(incomplete,[image,labelDetail])).toMatchObject({
      source:'attached-label-detail-crop',image:{regionRole:'label-detail'},region:{role:'other',region:crop},
    });
    const adequateRows=['Energy','Carbohydrates','Added Sugars','Total Sugars','Protein','Total Fat'].map((nutrient,index)=>({...base.nutritionRows[0],rowId:`complete-${index}`,nutrient,value:index+1,printedValue:`${index+1} g`}));
    const ingredientOnlyGap={...base,regions:[],nutritionRows:adequateRows,ingredients:[]};
    expect(selectNutritionRecoveryRegion(ingredientOnlyGap,[image,labelDetail])).toMatchObject({source:'attached-label-detail-crop'});
    expect(selectNutritionRecoveryRegion({...base,regions:[],nutritionRows:adequateRows},[image])).toBeNull();
  });

  it('prefers an attached nutrition-table crop over a broader OCR-selected dense-text crop',()=>{
    const broadLabelDetail={...image,regionRole:'label-detail' as const,preprocessing:{...image.preprocessing,crop:{x:0.04,y:0.04,width:0.9,height:0.76}}};
    const nutritionCrop={...image,regionRole:'nutrition-table' as const,preprocessing:{...image.preprocessing,crop:{x:0.08,y:0.08,width:0.36,height:0.48}}};
    expect(selectNutritionRecoveryRegion({...base,regions:[]},[image,broadLabelDetail,nutritionCrop])).toMatchObject({
      source:'attached-ocr-crop',image:{regionRole:'nutrition-table'},
    });
  });

  it('adds photo-linked rows provisionally, preserves ingredients, and marks same-column disagreement as conflict',()=>{
    const recovery={
      serving:null,
      nutritionRows:[
        {rowId:'model-carb',nutrient:'Carbohydrates',nutrientKey:'carbohydrate',printedLabel:'Carbohydrates',printedValue:'9.82 g',value:9.82,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g' as const,qualifier:null,status:'clear' as const,evidence:{observationIds:['known-line','not-known']}},
        {rowId:'model-protein',nutrient:'Protein',nutrientKey:'protein',printedLabel:'Protein',printedValue:'1.53 g',value:1.53,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g' as const,qualifier:null,status:'clear' as const,evidence:{observationIds:[]}},
      ],
    };
    const parsed=focusedLabelRecoverySchema.safeParse(recovery);
    expect(parsed.success).toBe(true);
    if(!parsed.success)throw parsed.error;
    const merged=mergeFocusedLabelRecovery(base,parsed.data,'back-1',crop,new Set(['known-line']));
    expect(merged.nutritionRows).toHaveLength(3);
    expect(merged.nutritionRows.filter(row=>row.nutrient==='Carbohydrates').map(row=>row.status)).toEqual(['conflict','conflict']);
    expect(merged.nutritionRows.find(row=>row.nutrient==='Protein')).toMatchObject({status:'provisional',evidence:{observationIds:[],imageRegions:[{imageId:'back-1',region:crop}]}});
    expect(merged.nutritionRows.find(row=>row.nutrient==='Carbohydrates'&&row.value===9.82)?.evidence.observationIds).toEqual(['known-line']);
    expect(merged.unresolved.some(item=>item.field==='nutrition:Carbohydrates')).toBe(true);
    expect(merged.ingredients).toEqual(base.ingredients);
  });

  it('treats the application-selected crop as authoritative instead of asking Gemini to return crop coordinates',()=>{
    const recovered=focusedLabelRecoverySchema.safeParse({
      serving:null,
      nutritionRows:[{rowId:'carb',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[]}}],
    });
    expect(recovered.success).toBe(true);
    if(!recovered.success)throw recovered.error;
    const merged=mergeFocusedLabelRecovery(base,recovered.data,'back-1',crop,new Set());
    expect(merged.nutritionRows.at(-1)?.evidence.imageRegions).toEqual([{imageId:'back-1',region:crop}]);
  });

  it('merges identical rereads and enriches one exact basisless value without collapsing different printed columns',()=>{
    const basisless={...base.nutritionRows[0],rowId:'carb-100',nutrient:'Carbohydrate',printedLabel:'CARBOHYDRATES',printedValue:'69.29 g',value:69.29,columnLabel:null,basisText:null,basisAmount:null,basisUnit:null};
    const existing={...base,nutritionRows:[...base.nutritionRows,basisless]};
    const recovered=focusedLabelRecoverySchema.parse({
      serving:null,
      nutritionRows:[
        {...base.nutritionRows[0],rowId:'same-serving',nutrient:'Carbohydrates',printedValue:'9.28 g',value:9.28,columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',evidence:{observationIds:[]}},
        {...basisless,rowId:'same-100g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',evidence:{observationIds:[]}},
      ],
    });
    const merged=mergeFocusedLabelRecovery(existing,recovered,'back-1',crop,new Set());
    expect(merged.nutritionRows).toHaveLength(2);
    expect(merged.nutritionRows.find(row=>row.rowId==='carb-serving')?.evidence.imageRegions).toEqual([{imageId:'back-1',region:crop}]);
    expect(merged.nutritionRows.find(row=>row.rowId==='carb-100')).toMatchObject({basisAmount:100,basisUnit:'g',status:'provisional'});

    const knownBasis={...basisless,columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g' as const};
    const equalButDifferentColumns=focusedLabelRecoverySchema.parse({
      serving:null,
      nutritionRows:[{...knownBasis,rowId:'equal-serving',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',evidence:{observationIds:[]}}],
    });
    const keptSeparate=mergeFocusedLabelRecovery({...existing,nutritionRows:[knownBasis]},equalButDifferentColumns,'back-1',crop,new Set());
    expect(keptSeparate.nutritionRows).toHaveLength(2);
    expect(keptSeparate.nutritionRows.map(row=>row.basisText)).toEqual(['per 100 g','per serving']);
  });

  it('recovers ingredients, additives and package statements from the same focused crop with image lineage',()=>{
    const recovered=focusedLabelRecoverySchema.parse({
      serving:null,
      nutritionRows:[],
      ingredients:[
        {position:0,name:'Refined wheat flour (maida)',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'clear',evidence:{observationIds:['known-line']}},
        {position:1,name:'Vegetable oil',printedText:'HYDROGENATED VEGETABLE OIL',printedPercentage:null,normalizedName:'vegetable oil',status:'clear',evidence:{observationIds:[]}},
      ],
      additives:[{printedName:'Antioxidant (319)',code:'319',normalizedName:'TBHQ',status:'clear',evidence:{observationIds:[]}}],
      statements:[{kind:'claim',label:'Sugar free',text:'FREE OF SUGAR',status:'clear',evidence:{observationIds:[]}}],
    });
    const merged=mergeFocusedLabelRecovery(base,recovered,'back-1',crop,new Set(['known-line']));
    expect(merged.ingredients).toHaveLength(2);
    expect(merged.ingredients[0]).toMatchObject({printedPercentage:89.98,status:'provisional',evidence:{observationIds:['known-line'],imageRegions:[{imageId:'back-1',region:crop}]}});
    expect(merged.additives[0]).toMatchObject({code:'319',status:'provisional',evidence:{imageRegions:[{imageId:'back-1',region:crop}]}});
    expect(merged.statements[0]).toMatchObject({kind:'claim',text:'FREE OF SUGAR',status:'provisional',evidence:{imageRegions:[{imageId:'back-1',region:crop}]}});
  });

  it('preserves distinct ingredient percentage readings as a conflict instead of overwriting either',()=>{
    const recovered=focusedLabelRecoverySchema.parse({
      serving:null,
      nutritionRows:[],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (69.98%)',printedPercentage:69.98,normalizedName:'refined wheat flour',status:'clear',evidence:{observationIds:[]}}],
    });
    const merged=mergeFocusedLabelRecovery(base,recovered,'back-1',crop,new Set());
    expect(merged.ingredients.filter(item=>item.name.toLocaleLowerCase().includes('wheat flour')).map(item=>item.printedPercentage)).toEqual([89.98,69.98]);
    expect(merged.ingredients.filter(item=>item.name.toLocaleLowerCase().includes('wheat flour')).map(item=>item.status)).toEqual(['conflict','conflict']);
    expect(merged.unresolved.some(item=>item.field==='ingredient:Refined wheat flour')).toBe(true);
  });
});
