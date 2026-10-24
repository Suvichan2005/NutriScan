import { describe, expect, it } from 'vitest';
import { packageReconstructionContentSchema, packageSchema } from '../contracts';
import { validateInferenceOutput } from '../../modules/inference/core';
import { evidenceSources } from '../../modules/knowledge';
import { attachGoogleGrounding, buildStructureRepairContents, compactSavedPackageFacts, compactSavedReconstruction, focusedIngredientRecoverySchema, focusedLabelRecoverySchema, getAgentSystemInstruction, getAgentToolDeclarations, googleGroundingEvidence, mergeFocusedLabelRecovery, needsConversationalAnswerRepair, needsPackageAnswerSynthesis, normalizeModelImageRegions, normalizeProviderAssistOutput, packageAnswerCoverage, packageAnswerSynthesisCompletesMissingFacets, parseAgentProviderOutput, requestedIngredientIdentityCoverageFacts, requiresExplicitNutritionGuidanceLookup, sanitizeAssistantEvidenceLabels, selectIngredientRecoveryRegion, selectNutritionRecoveryRegion, shouldRetrieveContextualNutritionGuidance, supplementRequestedCompositionCoverage, supplementRequestedIngredientIdentityCoverage, supplementRequestedNutritionGuidanceCoverage, toolResultForModel, type RetrievedCompositionFact } from './gemini';
import { executeGeminiTool } from './gemini-tools';
import { getNutritionGuidance, getNutritionGuidanceCoverageFacts } from './nutrition-guidance';

describe('nutrition-guidance tool routing', () => {
  it('forces a local lookup when the user explicitly asks for guideline guidance', () => {
    expect(requiresExplicitNutritionGuidanceLookup('According to WHO, what does the guideline say about added sugars?')).toBe(true);
  });

  it('does not force a diabetes-specific lookup merely because suitability mentions diabetes', () => {
    expect(requiresExplicitNutritionGuidanceLookup('Is this good to have for diabetic patients daily for snacking?')).toBe(false);
    expect(requiresExplicitNutritionGuidanceLookup('Is this a reasonable daily snack?')).toBe(false);
    expect(requiresExplicitNutritionGuidanceLookup('How much carbohydrate is printed?')).toBe(false);
  });

  it('preloads applicable local guidance for a condition-linked food-choice question, not every condition mention', () => {
    expect(shouldRetrieveContextualNutritionGuidance('Is this good to have for diabetic patients daily for snacking?')).toBe(true);
    expect(shouldRetrieveContextualNutritionGuidance('How much carbohydrate is printed for someone with diabetes?')).toBe(false);
    expect(shouldRetrieveContextualNutritionGuidance('Is this a reasonable daily snack?')).toBe(false);
  });

  it('can retrieve global diabetes education for an India-market snack question without selecting US-only guidance', () => {
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
});

describe('saved-package follow-up context',()=>{
  it('uses a shorter saved-package instruction set on photo-free follow-ups',()=>{
    const initial=getAgentSystemInstruction(true,true);
    const followup=getAgentSystemInstruction(false,false);
    expect(followup.length).toBeLessThan(initial.length*0.7);
    expect(followup).toContain('saved reconstruction');
    expect(followup).toContain('calculate_nutrition');
    expect(followup).toContain('packageFactIds');
    expect(followup).not.toContain('interpret the entire package from all attached photos');
    expect(followup).not.toContain('The visualImages metadata is aligned');
  });

  it('adds visual recovery guidance and image inspection only when image bytes are attached',()=>{
    expect(getAgentSystemInstruction(false,true)).toContain('The visualImages metadata is aligned');
    expect(getAgentToolDeclarations(false).some(tool=>tool.name==='inspect_package_image')).toBe(false);
    expect(getAgentToolDeclarations(true).some(tool=>tool.name==='inspect_package_image')).toBe(true);
  });

  it('keeps portion-relevant saved rows and a short ingredient context without replaying OCR regions',()=>{
    const saved=packageReconstructionContentSchema.parse({
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
      serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
      nutritionRows:[
        {rowId:'carbs-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
        {rowId:'carbs-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Quantity per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
        {rowId:'protein-serving',nutrient:'Protein',printedLabel:'Protein',printedValue:'1.53 g',value:1.53,unit:'g',columnLabel:'Quantity per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
        {rowId:'fat-serving',nutrient:'Total Fat',printedLabel:'Total Fat',printedValue:'2.38 g',value:2.38,unit:'g',columnLabel:'Quantity per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
      ],
      ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},{position:1,name:'Vegetable oil',printedText:'vegetable oil',printedPercentage:null,normalizedName:'vegetable oil',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},{position:2,name:'Sugar substitute',printedText:'sweetener',printedPercentage:null,normalizedName:null,status:'ambiguous',evidence:{observationIds:[],imageRegions:[]}},{position:3,name:'Salt',printedText:'salt',printedPercentage:null,normalizedName:'salt',status:'provisional',evidence:{observationIds:[],imageRegions:[]}}],
      additives:[],statements:[],regions:[{imageId:'back',role:'nutrition-table',region:{x:0,y:0,width:.4,height:1},observationIds:[]}],unresolved:[],interpretationNote:'Saved provisional package interpretation.',
    });
    const context=compactSavedReconstruction(saved,'What about just two biscuits? Previous question: Is this a good daily diabetic snack?');
    expect(context.nutritionRows.map(row=>row.nutrient)).toContain('Carbohydrates');
    expect(context.nutritionRows.length).toBe(4);
    expect(context.ingredients.map(item=>item.name)).toEqual(['Refined wheat flour','Vegetable oil','Sugar substitute']);
    expect(context.regions).toEqual([]);
    expect(context.unresolved).toEqual([]);
  });

  it('sends all ingredient facts only when the follow-up asks to inspect the ingredient list',()=>{
    const facts=[
      {id:'package-fact:identity',text:'Bisk Farm Sugar Free Cream Cracker'},
      {id:'package-fact:serving',text:'Two biscuits, approximately 13.4 g'},
      ...Array.from({length:8},(_,index)=>({id:`package-fact:ingredient:${index}`,text:index===7?'Ingredient 8: Palm oil':'Ingredient '+(index+1)})),
      {id:'package-fact:additive:0',text:'INS 319'},
      {id:'package-fact:statement:0',text:'Package claim: No added sugar'},
      {id:'package-fact:statement:1',text:'Package may-contain statement: peanuts'},
    ];
    const portionFacts=compactSavedPackageFacts(facts,'What about just two biscuits? Previous question: Is this a suitable daily snack?');
    expect(portionFacts.map(fact=>fact.id)).toContain('package-fact:serving');
    expect(portionFacts.map(fact=>fact.id)).toContain('package-fact:ingredient:0');
    expect(portionFacts.map(fact=>fact.id)).not.toContain('package-fact:ingredient:7');
    expect(portionFacts.map(fact=>fact.id)).not.toContain('package-fact:additive:0');
    expect(portionFacts.map(fact=>fact.id)).toContain('package-fact:statement:0');
    expect(compactSavedPackageFacts(facts,'List the ingredients and additives').map(fact=>fact.id)).toContain('package-fact:ingredient:7');
    expect(compactSavedPackageFacts(facts,'List the ingredients and additives').map(fact=>fact.id)).toContain('package-fact:additive:0');
    expect(compactSavedPackageFacts(facts,'Is palm oil okay?').map(fact=>fact.id)).toContain('package-fact:ingredient:7');
    expect(compactSavedPackageFacts(facts,'Does this contain nuts?').map(fact=>fact.id)).toContain('package-fact:statement:1');
  });
});

describe('model answer-part recovery', () => {
  it('uses answer repair only when no conversational wording survived validation', () => {
    expect(needsConversationalAnswerRepair(1, 2, true, false)).toBe(false);
    // The citation-repair stage may already have run; only a prior
    // conversational answer repair consumes this independent one-shot budget.
    expect(needsConversationalAnswerRepair(0, 4, true, false)).toBe(true);
    expect(needsConversationalAnswerRepair(1, 0, true, false)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 4, true, false, true)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 0, true, false, true, 1)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 0, true, true, true, 1)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 4, true, true)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 0, false, false)).toBe(false);
  });

  it('maps evidenceClaims and claimIds into the shared response contract', () => {
    const output = normalizeProviderAssistOutput({
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

  it('repairs a missing answer link only when the answer part exactly repeats one grounded claim', () => {
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

    expect(normalized?.answerParts).toEqual([{ text: answer, claimIndexes: [0] }]);
    expect(paraphrase?.claims).toHaveLength(1);
    expect(paraphrase?.answerParts).toBeUndefined();
  });

  it('preserves evidence-linked follow-up claims when answer prose has no valid links, for bounded conversational repair', () => {
    const claim = 'The package lists refined wheat flour as an ingredient.';
    const answer = 'The ingredient list is led by refined wheat flour.';
    const output = normalizeProviderAssistOutput({
      answer,
      answerParts: [{ text: answer, claimIndexes: [] }],
      claims: [{ text: claim, observationIds: ['ocr-ingredients'], sourceIds: [] }],
      limitations: [], inspectImage: null,
    });

    expect(output?.claims).toHaveLength(1);
    expect(output?.claims[0].text).toBe(claim);
    expect(output?.answerParts).toBeUndefined();
    expect(needsConversationalAnswerRepair(0, 1, true, false)).toBe(true);
  });

  it('links an alternate answer body only to its explicitly supplied calculation and interpretation references', () => {
    const answer='For two biscuits (approximately 13.4 g), provisional carbohydrate is about 9.28 g.';
    const output=normalizeProviderAssistOutput({
      answerParts:[{body:answer,calculationIds:['CALC_1'],interpretationRowIds:['ROW_1']}],
      uiComponents:[],
    });

    expect(output?.answer).toBe(answer);
    expect(output?.claims).toEqual([{
      mode:'synthesis',text:answer,observationIds:[],sourceIds:[],calculationIds:['CALC_1'],
      interpretationRowIds:['ROW_1'],packageFactIds:[],profileFieldIds:[],
    }]);
    expect(output?.answerParts).toEqual([{text:answer,claimIndexes:[0]}]);
  });

  it('normalizes package-fact citations on alternate answer-part shapes',()=>{
    const answer='The package appears to list refined wheat flour first.';
    const output=normalizeProviderAssistOutput({
      answerParts:[{body:answer,package_fact_ids:['package-fact:ingredient:0']}],
      limitations:[],inspectImage:null,
    });

    expect(output?.claims).toMatchObject([{text:answer,packageFactIds:['package-fact:ingredient:0']}]);
    expect(output?.answerParts).toEqual([{text:answer,claimIndexes:[0]}]);
  });

  it('keeps an answer part citation set separate from overlapping sibling claims',()=>{
    const answer='For two biscuits (approximately 13.4 g), provisional carbohydrate is about 9.3 g.';
    const output=normalizeProviderAssistOutput({
      answerParts:[{text:answer,observationIds:['OBS_I'],calculationIds:['CALC_1'],interpretationRowIds:['ROW_1']}],
      claims:[{mode:'synthesis',text:'An unrelated serving statement.',observationIds:['OBS_I'],sourceIds:[],calculationIds:[],interpretationRowIds:[],profileFieldIds:[]}],
    });

    expect(output?.claims).toHaveLength(2);
    expect(output?.claims[1]).toMatchObject({text:answer,observationIds:['OBS_I'],calculationIds:['CALC_1'],interpretationRowIds:['ROW_1']});
    expect(output?.answerParts).toEqual([{text:answer,claimIndexes:[1]}]);
  });

  it('resolves alternate claimIds that actually name cited evidence aliases',()=>{
    const answer='Two biscuits (about 13.4 g) provide 9.28 g carbohydrate and 0 g added sugars.';
    const output=normalizeProviderAssistOutput({
      answer,
      answerParts:[{text:answer,claimIds:['CALC_1','CALC_2']}],
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

  it('drops malformed optional answer-part links while preserving the natural answer and claims', () => {
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
    expect(output?.answerParts).toBeUndefined();
    expect(output?.claims).toHaveLength(1);
  });

  it('retains schema-valid empty evidence output for the caller to classify as unsupported quality', () => {
    const output = normalizeProviderAssistOutput({ answer: 'Unsupported prose.', claims: [], limitations: [], inspectImage: null });
    expect(output?.claims).toEqual([]);
    expect(output?.answerParts).toBeUndefined();
  });
});

describe('package-answer synthesis coverage gate',()=>{
  const reconstruction=packageReconstructionContentSchema.parse({
    identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:'Sugar Free',status:'provisional',evidence:{observationIds:[],imageRegions:[]}},
    serving:{printedText:'2 biscuits, approximately 13.4 g',quantity:13.4,unit:'g',pieceCount:2,pieceDescription:'biscuits',status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]}},
    nutritionRows:[
      {rowId:'carbs-100g',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'69.29 g',value:69.29,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['carb-line'],imageRegions:[]}},
      {rowId:'carbs-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Quantity per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['carb-line'],imageRegions:[]}},
      {rowId:'added-sugars-100g',nutrient:'Added Sugars',printedLabel:'Added Sugars',printedValue:'0 g',value:0,unit:'g',columnLabel:'Per 100 g',basisText:'per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:['sugar-line'],imageRegions:[]}},
    ],
    ingredients:[{position:0,name:'Refined wheat flour',printedText:'REFINED WHEAT FLOUR (MAIDA) (89.98%)',printedPercentage:89.98,normalizedName:'refined wheat flour',status:'provisional',evidence:{observationIds:['ingredient-line'],imageRegions:[]}}],
    additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Provisional reconstruction for coverage-gate tests.',
  });
  const guidance=getNutritionGuidance({query:'Is this good to have for diabetic patients daily for snacking?',condition:'diabetes',jurisdiction:'India',maxResults:1});
  const question='Is this good to have for diabetic patients daily for snacking?';

  it('requests one synthesis pass when a food-choice answer omits package facts needed for the decision',()=>{
    const ingredientOnly=[{mode:'synthesis' as const,text:'The first listed ingredient is refined wheat flour.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']}];
    expect(packageAnswerCoverage(question,reconstruction,ingredientOnly,guidance)).toMatchObject({available:4,covered:1,missing:['nutrition','serving','local-guidance']});
    expect(needsPackageAnswerSynthesis(question,reconstruction,ingredientOnly,guidance)).toBe(true);
  });

  it('synthesizes a grounded saved-package answer for an ungrounded quantity follow-up, but not a covered answer',()=>{
    const complete=[
      {mode:'synthesis' as const,text:'The provisional carbohydrate amount is 9.28 g per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
      {mode:'synthesis' as const,text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'The printed serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
      {mode:'synthesis' as const,text:'The cited guidance discusses individualized food choices.',observationIds:[],sourceIds:guidance.map(source=>source.id)},
    ];
    expect(needsPackageAnswerSynthesis('What about just two biscuits?',reconstruction,[],guidance)).toBe(true);
    expect(needsPackageAnswerSynthesis(question,reconstruction,complete,guidance,'These may fit occasionally, but I would not choose them as a default daily snack. The label provisionally lists 9.28 g carbohydrates per serving. Refined wheat flour is listed first. One serving is two biscuits, approximately 13.4 g. IDF guidance discusses individualized carbohydrate portions.')).toBe(false);
  });

  it('requests a direct practical position when a food-choice answer only lists supported facts',()=>{
    const incompleteReconstruction=packageReconstructionContentSchema.parse({
      ...reconstruction,
      serving:null,
      nutritionRows:[],
      statements:[],
    });
    const claims=[
      {mode:'synthesis' as const,text:'Refined wheat flour is listed first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'IDF guidance discusses carbohydrate portions and higher-fibre snacks.',observationIds:[],sourceIds:guidance.map(source=>source.id)},
    ];
    const factsOnly='The package lists refined wheat flour first. IDF guidance discusses carbohydrate portions and higher-fibre snacks.';
    expect(packageAnswerCoverage(question,incompleteReconstruction,claims,guidance,factsOnly)).toMatchObject({missing:[]});
    expect(needsPackageAnswerSynthesis(question,incompleteReconstruction,claims,guidance,factsOnly)).toBe(true);
    expect(needsPackageAnswerSynthesis(question,incompleteReconstruction,claims,guidance,'This is not a strong everyday default; the label lists refined wheat flour first. IDF guidance discusses carbohydrate portions and higher-fibre snacks.')).toBe(false);
  });

  it('requires a relevant supplied source only when local guidance was actually selected',()=>{
    const packageClaims=[
      {mode:'synthesis' as const,text:'The label appears to list 9.28 g carbohydrates per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
      {mode:'synthesis' as const,text:'Refined wheat flour is listed first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'One serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
    ];
    const packageAnswer='The label appears to list 9.28 g carbohydrates per serving. One serving is two biscuits, approximately 13.4 g, and refined wheat flour is listed first.';
    expect(packageAnswerCoverage(question,reconstruction,packageClaims,[],packageAnswer)).toMatchObject({missing:[]});
    expect(packageAnswerCoverage(question,reconstruction,packageClaims,guidance,packageAnswer)).toMatchObject({missing:['local-guidance']});
    expect(needsPackageAnswerSynthesis(question,reconstruction,packageClaims,guidance,packageAnswer)).toBe(true);

    const sourceClaim={mode:'synthesis' as const,text:'IDF education notes refined carbohydrates can affect blood glucose.',observationIds:[],sourceIds:guidance.map(source=>source.id)};
    const sourcedAnswer=`This is not a strong everyday default based on the available label. ${packageAnswer} IDF education notes that refined carbohydrates can affect blood glucose.`;
    expect(packageAnswerCoverage(question,reconstruction,[...packageClaims,sourceClaim],guidance,sourcedAnswer)).toMatchObject({missing:[]});
    expect(needsPackageAnswerSynthesis(question,reconstruction,[...packageClaims,sourceClaim],guidance,sourcedAnswer)).toBe(false);
  });

  it('does not synthesize a package answer when the saved reconstruction has no evidence-backed details',()=>{
    const empty=packageReconstructionContentSchema.parse({
      identity:{brand:null,name:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'',
    });
    expect(needsPackageAnswerSynthesis('What about two biscuits?',empty,[])).toBe(false);
    expect(needsPackageAnswerSynthesis('What about two biscuits?',null,[])).toBe(false);
  });

  it('does not count hidden claim coverage when the visible answer omits nutrition and serving details',()=>{
    const completeClaims=[
      {mode:'synthesis' as const,text:'The provisional carbohydrate amount is 9.28 g per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
      {mode:'synthesis' as const,text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'The printed serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
      {mode:'synthesis' as const,text:'The cited guidance discusses individualized food choices.',observationIds:[],sourceIds:guidance.map(source=>source.id)},
    ];
    const genericAnswer='These crackers may not be ideal for daily snacking because their primary ingredient is refined wheat flour.';
    expect(packageAnswerCoverage(question,reconstruction,completeClaims,guidance,genericAnswer)).toMatchObject({
      available:4,covered:1,missing:['nutrition','serving','local-guidance'],
    });
    expect(needsPackageAnswerSynthesis(question,reconstruction,completeClaims,guidance,genericAnswer)).toBe(true);

    const completeAnswer='The label provisionally shows 9.28 g carbohydrates for that serving; two biscuits weigh approximately 13.4 g. Refined wheat flour is listed first.';
    expect(packageAnswerCoverage(question,reconstruction,completeClaims,guidance,completeAnswer)).toMatchObject({
      available:4,missing:[],
    });
  });

  it('does not let a zero-added-sugar reading substitute for the relevant per-serving carbohydrate row',()=>{
    const claims=[
      {mode:'synthesis' as const,text:'The label lists 0 g added sugars per 100 g.',observationIds:[],sourceIds:[],interpretationRowIds:['added-sugars-100g']},
      {mode:'synthesis' as const,text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'A serving is two biscuits, about 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
    ];
    const answer='The label lists 0 g added sugars per 100 g. A serving is two biscuits, about 13.4 g, and refined wheat flour is listed first.';
    expect(packageAnswerCoverage(question,reconstruction,claims,guidance,answer)).toMatchObject({
      available:4,covered:2,missing:['nutrition','local-guidance'],
    });
  });

  it('contextualizes a relevant nutrition claim instead of letting it replace the numeric reading',()=>{
    const withSugarClaim={...reconstruction,statements:[{
      kind:'claim' as const,label:null,text:'Sugar Free',status:'provisional' as const,
      evidence:{observationIds:['sugar-claim-line'],imageRegions:[]},
    }]};
    const baseClaims=[
      {mode:'synthesis' as const,text:'The label appears to list 9.28 g carbohydrates per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
      {mode:'synthesis' as const,text:'Refined wheat flour is listed first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'One serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
    ];
    const answer='The label appears to list 9.28 g carbohydrates per serving. One serving is two biscuits, approximately 13.4 g, and refined wheat flour is listed first.';
    expect(packageAnswerCoverage(question,withSugarClaim,baseClaims,guidance,answer)).toMatchObject({
      available:5,covered:3,missing:['nutrition-claim','local-guidance'],
    });
    expect(needsPackageAnswerSynthesis(question,withSugarClaim,baseClaims,guidance,answer)).toBe(true);

    const contextualized=[...baseClaims,{
      mode:'synthesis' as const,text:'The packet also carries a sugar-free claim; that does not replace the carbohydrate reading.',
      observationIds:[],sourceIds:[],packageFactIds:['package-fact:statement:0'],
    },{
      mode:'synthesis' as const,text:'IDF patient education notes that refined carbohydrate choices can affect blood glucose and should be individualized.',
      observationIds:[],sourceIds:guidance.map(source=>source.id),
    }];
    const completeAnswer=`This is not a strong everyday default. ${answer} It also carries a sugar-free claim; the carbohydrate figure remains the more relevant amount. IDF patient education notes that refined carbohydrate choices can affect blood glucose and should be individualized.`;
    expect(packageAnswerCoverage(question,withSugarClaim,contextualized,guidance,completeAnswer)).toMatchObject({
      available:5,missing:[],
    });
    expect(needsPackageAnswerSynthesis(question,withSugarClaim,contextualized,guidance,completeAnswer)).toBe(false);
  });

  it('does not call a synthesis complete while a supplied nutrition row or serving facet is still omitted',()=>{
    const before=packageAnswerCoverage(question,reconstruction,[{mode:'synthesis',text:'Refined wheat flour is listed first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']}],guidance);
    const partial=packageAnswerCoverage(question,reconstruction,[
      {mode:'synthesis',text:'Refined wheat flour is listed first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis',text:'IDF guidance says snack choices should be individualized.',observationIds:[],sourceIds:guidance.map(source=>source.id)},
    ],guidance);
    expect(packageAnswerSynthesisCompletesMissingFacets(before,partial)).toBe(false);
    expect(packageAnswerSynthesisCompletesMissingFacets(before,before)).toBe(false);
  });

  it('rejects a synthesis that still omits the declared serving and accepts one that covers all package facets',()=>{
    const before=packageAnswerCoverage(question,reconstruction,[
      {mode:'synthesis' as const,text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'The provisional carbohydrate amount is 9.28 g per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
    ],guidance);
    const swapped=packageAnswerCoverage(question,reconstruction,[
      {mode:'synthesis' as const,text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'The provisional carbohydrate amount is 9.28 g per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
      {mode:'synthesis' as const,text:'The cited guidance discusses individualized food choices.',observationIds:[],sourceIds:guidance.map(source=>source.id)},
    ],guidance);
    const complete=[
      {mode:'synthesis' as const,text:'The provisional carbohydrate amount is 9.28 g per serving.',observationIds:[],sourceIds:[],interpretationRowIds:['carbs-serving']},
      {mode:'synthesis' as const,text:'The package lists refined wheat flour first.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:ingredient:0']},
      {mode:'synthesis' as const,text:'The printed serving is two biscuits, approximately 13.4 g.',observationIds:[],sourceIds:[],packageFactIds:['package-fact:serving']},
      {mode:'synthesis' as const,text:'The cited guidance discusses individualized food choices.',observationIds:[],sourceIds:guidance.map(source=>source.id)},
    ];
    const after=packageAnswerCoverage(question,reconstruction,complete,guidance);
    expect(before).toMatchObject({available:4,covered:2,missing:['serving','local-guidance']});
    expect(swapped).toMatchObject({available:4,covered:3,missing:['serving']});
    expect(packageAnswerSynthesisCompletesMissingFacets(before,swapped)).toBe(false);
    expect(packageAnswerSynthesisCompletesMissingFacets(before,after)).toBe(true);
  });

  it('removes model-emitted internal reference handles from consumer prose without altering evidence IDs',()=>{
    const sanitized=sanitizeAssistantEvidenceLabels({
      answer:'Two biscuits are a serving [package-fact:serving]; the carb amount is 69.29 g per 100 g [ROW_1] [priorityNutritionRows] [nutritionRows] [RDA] [refined wheat flour].',
      answerParts:[{text:'The label lists refined flour [OBS_1].',claimIndexes:[0]}],
      claims:[{text:'The label lists refined flour [OBS_1].',observationIds:['actual-observation-id'],sourceIds:[],interpretationRowIds:['actual-row-id']}],
    }) as {answer:string;answerParts:Array<{text:string}>;claims:Array<{observationIds:string[];interpretationRowIds:string[]}>};
    expect(sanitized.answer).toBe('Two biscuits are a serving; the carb amount is 69.29 g per 100 g [RDA] [refined wheat flour].');
    expect(sanitized.answerParts[0].text).toBe('The label lists refined flour.');
    expect(sanitized.claims[0]).toMatchObject({observationIds:['actual-observation-id'],interpretationRowIds:['actual-row-id']});
  });
});

describe('provider package-reconstruction normalization',()=>{
  it('unwraps one structured provider envelope and ignores transport-only root metadata without losing reconstruction',()=>{
    const reconstruction={
      identity:{brand:'Bisk Farm',name:'Cream Cracker',variant:null,status:'provisional',evidence:{observationIds:['OBS_1'],imageRegions:[]}},
      serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'',
    };
    const parsed=parseAgentProviderOutput(JSON.stringify({
      output:{answer:'The label reading is provisional.',claims:[],packageReconstruction:reconstruction,limitations:[],inspectImage:null},
      transportMetadata:{attempt:1},
    }),true);
    expect(parsed.modelOutputStatus).toBe('unlinked-answer-candidate');
    expect(parsed.output.packageReconstruction?.identity.brand).toBe('Bisk Farm');
    expect(parsed.output.claims).toMatchObject([{text:'The label reading is provisional.',observationIds:[],sourceIds:[]}]);
    expect(JSON.stringify(parsed.output)).not.toContain('transportMetadata');
  });

  it('classifies an omitted claim list as no grounded claims instead of a provider schema failure',()=>{
    const parsed=parseAgentProviderOutput(JSON.stringify({
      answer:'The package interpretation remains unresolved.',limitations:[],inspectImage:null,providerMetadata:{finish:'stop'},
    }));
    expect(parsed.modelOutputStatus).toBe('unlinked-answer-candidate');
    expect(parsed.output.claims).toMatchObject([{text:'The package interpretation remains unresolved.',observationIds:[],sourceIds:[]}]);
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

    expect(parsed.modelOutputStatus).toBe('unlinked-answer-candidate');
    expect(parsed.output.claims).toMatchObject([{text:'The package reading is provisional.',observationIds:[],sourceIds:[]}]);
    expect(parsed.output.packageReconstruction).toMatchObject({
      identity:{brand:'Bisk Farm',name:'Cream Cracker Sugar Free'},
      serving:{printedText:'2 biscuits (approx. 13.4 g)',quantity:13.4,unit:'g'},
      nutritionRows:[{rowId:'row_carbs_serving',value:9.28,unit:'g',basisAmount:13.4,basisUnit:'g',evidence:{observationIds:['OBS_CARBS']}}],
      ingredients:[{name:'refined wheat flour',printedPercentage:89.98,evidence:{observationIds:['OBS_INGREDIENT']}}],
      statements:[{kind:'claim',text:'No added sugars',evidence:{observationIds:['OBS_CLAIM']}}],
    });
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

describe('Gemini final-response failure classification', () => {
  it('repairs a schema mismatch from the prior text draft without replaying attached image parts',()=>{
    const draft=JSON.stringify({answer:'The label interpretation remains provisional.',claims:[],limitations:[],inspectImage:null});
    const contents=buildStructureRepairContents(draft,{issuePaths:['packageReconstruction.nutritionRows'],issueCodes:['invalid_type']});
    expect(contents).toHaveLength(1);
    expect(contents[0].parts).toHaveLength(1);
    expect(contents[0].parts?.[0]).toEqual(expect.objectContaining({text:expect.stringContaining(draft)}));
    expect(JSON.stringify(contents)).not.toContain('inlineData');
  });

  it('keeps valid grounded claims parseable when answer prose has no usable links, so the bounded repair stage can run', () => {
    const parsed = parseAgentProviderOutput(JSON.stringify({
      answer: 'The ingredient list is led by refined wheat flour.',
      answerParts: [{ text: 'This package lists refined wheat flour.', claimIndexes: [] }],
      claims: [{ text: 'The label lists refined wheat flour.', observationIds: ['ocr-ingredients'], sourceIds: [] }],
      limitations: [], inspectImage: null,
    }));

    expect(parsed.modelOutputStatus).toBe('claims-present');
    expect(parsed.output.claims).toHaveLength(1);
    expect(parsed.output.answerParts).toBeUndefined();
    expect(needsConversationalAnswerRepair(0, 1, true, false)).toBe(true);
  });

  it('keeps no grounded claims, invalid JSON and schema failure as distinct outcomes', () => {
    const noClaims = parseAgentProviderOutput(JSON.stringify({ answer: 'Text without linked claims.', claims: [], limitations: [], inspectImage: null }));
    let malformedJsonError: unknown;
    try { parseAgentProviderOutput('{not json'); } catch (error) { malformedJsonError = error; }
    let schemaError: unknown;
    try { parseAgentProviderOutput(JSON.stringify({ answer: 'bad schema', claims: 'not an array', limitations: [], inspectImage: null })); } catch (error) { schemaError = error; }

    expect(noClaims.modelOutputStatus).toBe('unlinked-answer-candidate');
    expect(noClaims.output.claims).toMatchObject([{text:'Text without linked claims.',observationIds:[],sourceIds:[]}]);
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

describe('explicit composition-answer coverage', () => {
  const facts:RetrievedCompositionFact[]=[
    {batchId:'call-1',sourceId:'fdc-idli',description:'Idli',dataType:'Survey (FNDDS)',nutrientId:1003,name:'Protein',reportedValue:'6.36 g',sourceSummary:'Idli. Values are per 100 g edible portion. Protein (nutrient ID 1003): 6.36 g per 100 g edible portion.'},
    {batchId:'call-1',sourceId:'fdc-idli',description:'Idli',dataType:'Survey (FNDDS)',nutrientId:1005,name:'Carbohydrate, by difference',reportedValue:'25 g',sourceSummary:'Idli. Values are per 100 g edible portion. Carbohydrate, by difference (nutrient ID 1005): 25 g per 100 g edible portion.'},
  ];
  const output={answer:'A retrieved reference is available.',claims:[],limitations:[],inspectImage:null};

  it('fills a missing explicitly requested nutrient only from the unique retrieved food record', () => {
    const result=supplementRequestedCompositionCoverage(output,'Report protein and total carbohydrate per 100 g for idli.',facts);
    expect(result.added).toBe(2);
    expect((result.output as {claims:Array<{text:string;sourceIds:string[];supportingSpans:Array<{quote:string}>}>}).claims.map(claim=>claim.text)).toEqual([
      'The USDA FNDDS survey reference entry “Idli” reports protein at 6.36 g per 100 g edible portion.',
      'The USDA FNDDS survey reference entry “Idli” reports carbohydrate at 25 g per 100 g edible portion.',
    ]);
  });

  it('does not duplicate a supported value or choose among competing foods returned by one search', () => {
    const complete=supplementRequestedCompositionCoverage(output,'Report protein and total carbohydrate for idli.',facts);
    const repeated=supplementRequestedCompositionCoverage(complete.output,'Report protein and total carbohydrate for idli.',facts);
    expect(repeated.added).toBe(0);
    const competing=[...facts,{...facts[0],sourceId:'fdc-rice',description:'Rice'}];
    expect(supplementRequestedCompositionCoverage(output,'Report protein for idli.',competing).added).toBe(0);
  });
});

describe('explicit nutrition-guidance answer coverage', () => {
  const question = 'Summarize what KDIGO 2024 says about sodium in chronic kidney disease.';
  const evidence = getNutritionGuidance({ query: question, condition: 'CKD', jurisdiction: 'India' });
  const facts = getNutritionGuidanceCoverageFacts(question, evidence.map(source => source.id));
  const output = { answer: '', claims: [], limitations: [], inspectImage: null };

  it('adds the source-backed numeric recommendation when Gemini only reports its caveat', () => {
    const result = supplementRequestedNutritionGuidanceCoverage(output, facts);
    expect(result.added).toBe(1);
    expect((result.output as { claims: Array<{ text: string; sourceIds: string[]; supportingSpans: Array<{ quote: string }> }> }).claims).toEqual([
      expect.objectContaining({
        text: evidence[0].summary,
        sourceIds: ['kdigo-ckd-2024-sodium'],
        supportingSpans: [{ kind: 'source', id: 'kdigo-ckd-2024-sodium', quote: evidence[0].summary }],
      }),
    ]);
  });

  it('does not add a duplicate when the model already states every required amount', () => {
    const complete = {
      ...output,
      claims: [{
        mode: 'synthesis' as const,
        text: 'KDIGO suggests sodium below 2 g/day for people with CKD.',
        observationIds: [], sourceIds: ['kdigo-ckd-2024-sodium'], calculationIds: [], profileFieldIds: [],
        supportingSpans: [{ kind: 'source' as const, id: 'kdigo-ckd-2024-sodium', quote: evidence[0].summary }], visualEvidence: [],
      }],
    };
    expect(supplementRequestedNutritionGuidanceCoverage(complete, facts).added).toBe(0);
  });

  it('does not treat an unsupported numeric answer as coverage when its cited span omits the amount', () => {
    const unsupported = {
      ...output,
      claims: [{
        mode: 'synthesis' as const,
        text: 'KDIGO recommends sodium below 2 g/day as a personal target.',
        observationIds: [], sourceIds: ['kdigo-ckd-2024-sodium'], calculationIds: [], profileFieldIds: [],
        supportingSpans: [{ kind: 'source' as const, id: 'kdigo-ckd-2024-sodium', quote: 'the guideline notes that this restriction is usually inappropriate in sodium-wasting nephropathy.' }],
        visualEvidence: [],
      }],
    };
    const packageData = packageSchema.parse({
        id: 'unsupported-guidance-coverage-test', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [],
        observations: [], rawText: '', warnings: [], synthetic: true, createdAt: '2026-10-23T00:00:00.000Z',
    });
    const validatedModelOutput = validateInferenceOutput(unsupported, {
      package: packageData,
      evidence,
    });
    const result = supplementRequestedNutritionGuidanceCoverage(validatedModelOutput, facts);
    const validated = validateInferenceOutput(result.output, { package: packageData, evidence });

    expect(validatedModelOutput.claims).toHaveLength(0);
    expect(result.added).toBe(1);
    expect((result.output as { claims: Array<{ text: string }> }).claims.at(-1)?.text).toBe(evidence[0].summary);
    expect(validated.claims).toHaveLength(1);
    expect(validated.claims[0].text).toContain('sodium below 2 g/day');
    expect(validated.answer).toContain('could not safely assemble it into a clear answer');
  });

  it('does not create coverage facts for an ordinary package question', () => {
    expect(getNutritionGuidanceCoverageFacts('How much sodium is in this package?', evidence.map(source => source.id))).toEqual([]);
  });

  it('keeps the recovered recommendation usable through final inference validation', () => {
    const question = 'For a general CKD question with unknown country, summarize what NutriScan guidance establishes about sodium and whether it establishes a potassium target. Do not personalize.';
    const sources = getNutritionGuidance({ query: question, condition: 'CKD' });
    const facts = getNutritionGuidanceCoverageFacts(question, sources.map(source => source.id));
    const supplemented = supplementRequestedNutritionGuidanceCoverage({ answer: '', claims: [], limitations: [], inspectImage: null }, facts);
    const validated = validateInferenceOutput(supplemented.output, {
      package: packageSchema.parse({
        id: 'guidance-coverage-test', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [],
        observations: [], rawText: '', warnings: [], synthetic: true, createdAt: '2026-10-23T00:00:00.000Z',
      }),
      evidence: sources,
    });

    expect(supplemented.added).toBe(1);
    expect(validated.claims).toHaveLength(1);
    expect(validated.claims[0].text).toContain('sodium below 2 g/day');
    expect(validated.answer).toContain('could not safely assemble it into a clear answer');
    expect(validated.claims[0].sourceIds).toEqual(['kdigo-ckd-2024-sodium']);
  });
});

describe('explicit additive-identity answer coverage', () => {
  const question = 'What does printed antioxidant code (319) mean? Please resolve it.';
  const packageData = packageSchema.parse({
    id: 'tbhq-identity-coverage-test', name: 'Unidentified package', ingredients: [], additives: [], allergens: [], claims: [], nutrients: [],
    observations: [{ id: 'ocr-additive-319', field: 'ocr-line', text: 'INGREDIENTS: antioxidant (319), raising agents [500(i), 503(ii)]', side: 'back', confidence: 78, origin: 'ocr', imageId: 'back-photo' }],
    rawText: '', warnings: [], synthetic: true, createdAt: '2026-10-23T00:00:00.000Z',
  });

  it('keeps a specifically requested local identity result usable with the OCR declaration and amount/authorization limits', async () => {
    const lookup = await executeGeminiTool('resolve_ingredient', { query: 'INS 319' }, {
      question, package: packageData, visualImages: [], searchTerms: new Set(), prepareImage: async () => '',
    });
    const facts = requestedIngredientIdentityCoverageFacts(question, packageData.observations, lookup);
    const supplemented = supplementRequestedIngredientIdentityCoverage({ answer: '', claims: [], limitations: [], inspectImage: null }, facts);
    const validated = validateInferenceOutput(supplemented.output, { package: packageData, evidence: lookup.evidence ?? [] });

    expect(lookup.status).toBe('ok');
    expect(facts).toHaveLength(1);
    expect(supplemented.added).toBe(1);
    expect(validated.claims).toHaveLength(1);
    expect(validated.claims[0].sourceIds).toContain('who-jecfa-tbhq-319');
    expect(validated.claims[0].observationIds).toEqual(['ocr-additive-319']);
    expect(validated.claims[0].text).toMatch(/INS 319.*Tertiary butylhydroquinone/i);
    expect(validated.claims[0].text).toMatch(/not the product.s additive amount or authorization/i);
    expect(validated.answer).toContain('could not safely assemble it into a clear answer');
  });

  it('does not promote an identity result without an explicit identity question and matching OCR declaration', async () => {
    const lookup = await executeGeminiTool('resolve_ingredient', { query: 'INS 319' }, {
      question: 'What nutrients are printed?', package: packageData, visualImages: [], searchTerms: new Set(), prepareImage: async () => '',
    });
    expect(requestedIngredientIdentityCoverageFacts('What nutrients are printed?', packageData.observations, lookup)).toEqual([]);
    expect(requestedIngredientIdentityCoverageFacts(question, [], lookup)).toEqual([]);
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
    nutritionRows:[{rowId:'carb-serving',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.28 g',value:9.28,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g',qualifier:null,status:'provisional',evidence:{observationIds:[],imageRegions:[]}}],
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
        {rowId:'model-carb',nutrient:'Carbohydrates',printedLabel:'Carbohydrates',printedValue:'9.82 g',value:9.82,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g' as const,qualifier:null,status:'clear' as const,evidence:{observationIds:['known-line','not-known']}},
        {rowId:'model-protein',nutrient:'Protein',printedLabel:'Protein',printedValue:'1.53 g',value:1.53,unit:'g',columnLabel:'Per serving',basisText:'per serving',basisAmount:13.4,basisUnit:'g' as const,qualifier:null,status:'clear' as const,evidence:{observationIds:[]}},
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
