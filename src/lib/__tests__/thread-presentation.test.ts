import { describe, expect, it } from 'vitest';
import { geminiFailureMessage, hasVisibleProvisionalPackageAmounts, mergeRecheckedPackageCandidates, packageDisplayIdentity, parseThreadAgentTrace, prepareAssistantTurnPresentation, preservePreviousAnswerAfterRejectedRecheck, savedConversationTurns, scaleCalculationToPortion, supersedePackageAnswers, type ThreadMessage } from '../thread-presentation';
import { packageSchema, savedConversationTurnSchema, type AssistantUiComponent, type Calculation, type TentativeStructuredCandidate } from '../contracts';

const identityCandidate = (proposedValue: string): TentativeStructuredCandidate => ({
  candidateId: 'identity-candidate',
  kind: 'product-identity',
  field: 'product identity',
  proposedValue,
  numericValue: null,
  unit: null,
  basis: null,
  normalizedEntity: null,
  status: 'tentative',
  uncertainty: 'Model suggestion; not verified.',
  observationIds: [],
  sourceIds: [],
  supportingSpans: [],
});

describe('package display identity', () => {
  it.each(['Dairy-based drink','Wholegrain breakfast','Roasted snack'])(
    'prefers current reconstructed identity over the plausible OCR description %s', name => {
      expect(packageDisplayIdentity({name,reconstruction:{current:true,identity:{brand:'Example',name:'Food',variant:'Original',status:'clear'}}},[]))
        .toEqual({title:'Example Food Original',source:'gemini'});
    });

  it('preserves explicit current user identity corrections over a reconstruction',()=>{
    const pkg={name:'My corrected product',observations:[{origin:'user' as const,field:'productName',text:'My corrected product'}],reconstruction:{current:true,identity:{brand:'Example',name:'Food',variant:null,status:'clear'}}};
    expect(packageDisplayIdentity(pkg,[])).toEqual({title:'My corrected product',source:'package'});
    expect(packageDisplayIdentity({...pkg,observations:[{origin:'user',field:'protein',text:'User correction: 4 g per 100 g; product name supplied by user: My corrected product'}]},[])).toEqual({title:'My corrected product',source:'package'});
  });

  it.each(['unreadable','conflict','ambiguous'])('does not promote a %s reconstruction identity',status=>{
    expect(packageDisplayIdentity({name:'Existing product',reconstruction:{current:true,identity:{brand:'New',name:'Identity',variant:null,status}}},[])).toEqual({title:'Existing product',source:'package'});
    expect(packageDisplayIdentity({name:'Existing product',reconstruction:{current:false,identity:{brand:'Old',name:'Identity',variant:null,status:'clear'}}},[])).toEqual({title:'Existing product',source:'package'});
  });
  it('keeps a structured package identity ahead of model suggestions', () => {
    expect(packageDisplayIdentity(
      { name: 'Bisk Farm Cream Cracker' },
      [identityCandidate('PROTEN TOTALFAT 17.79g 11.429 1539 238g')],
    )).toEqual({ title: 'Bisk Farm Cream Cracker', source: 'package' });
  });

  it('rejects OCR-like nutrient fragments from both package and Gemini titles', () => {
    expect(packageDisplayIdentity(
      { name: 'PROTEN TOTALFAT 17.79g 11.429 1539 238g 3.55%' },
      [identityCandidate('PROTEN TOTALFAT 17.79g 11.429 1539 238g 3.55%')],
    )).toEqual({ title: 'Unidentified food package', source: 'generic' });
  });

  it('does not promote a one-word front-of-pack slogan to package identity', () => {
    expect(packageDisplayIdentity({ name: 'FREE' }, [])).toEqual({ title: 'Unidentified food package', source: 'generic' });
  });

  it('shows a plausible Gemini-only identity with its source available for a visible label', () => {
    expect(packageDisplayIdentity(
      { name: 'Unidentified package' },
      [identityCandidate('Bisk Farm Cream Cracker')],
    )).toEqual({ title: 'Bisk Farm Cream Cracker', source: 'gemini' });
  });

  it('prefers a linked package reconstruction identity over an OCR line fragment', () => {
    expect(packageDisplayIdentity({
      name:'PROTEN TOTALFAT 17.79g 11.429',
      reconstruction:{identity:{brand:'Bisk Farm',name:'Sugar Free Cream Cracker',variant:null,status:'provisional'}},
    },[])).toEqual({title:'Bisk Farm Sugar Free Cream Cracker',source:'gemini'});
  });

  it('does not promote a front-of-pack sugar slogan over a linked product identity suggestion', () => {
    expect(packageDisplayIdentity(
      { name: 'BISK FARM FREE OF SUGAR, FULL OF TASTE' },
      [identityCandidate('Bisk Farm Sugar Free Cream Cracker')],
    )).toEqual({ title: 'Bisk Farm Sugar Free Cream Cracker', source: 'gemini' });
  });
});

describe('rechecked package interpretation candidates', () => {
  it('preserves the prior tentative identity when a recheck has no replacement identity', () => {
    const previous = [identityCandidate('Bisk Farm Sugar Free Cream Cracker')];
    expect(mergeRecheckedPackageCandidates(previous, [])).toEqual(previous);
  });

  it('uses a newly returned identity without carrying forward stale interpretations', () => {
    const previous = [identityCandidate('Bisk Farm Sugar Free Cream Cracker')];
    const replacement = identityCandidate('Bisk Farm Cream Cracker');
    expect(mergeRecheckedPackageCandidates(previous, [replacement])).toEqual([replacement]);
  });
});

describe('answer provenance for visible serving tools', () => {
  const calculation: Calculation = {
    id: 'provisional-carbohydrate', label: 'Carbohydrate per serving', nutrient: 'carbohydrate', input: 69.29, inputUnit: 'g', basisAmount: 100,
    portion: 13.4, portionUnit: 'g', result: 9.28, unit: 'g', formula: '69.29 g × 13.4 g ÷ 100 g',
    observationIds: ['ocr-carbohydrate'], imageIds: ['package-back'], interpretationIds: ['carbohydrate-row'], assumptions: ['Provisional package interpretation.'],
  };

  it('marks the answer when a visible calculator presents a provisional package calculation', () => {
    expect(hasVisibleProvisionalPackageAmounts(
      [{ type: 'portion-calculator', observationIds: [], sourceIds: [], calculationIds: [calculation.id] }],
      [calculation],
    )).toBe(true);
  });

  it('does not mark unrelated or user-confirmed calculations as provisional', () => {
    expect(hasVisibleProvisionalPackageAmounts(
      [{ type: 'portion-calculator', observationIds: [], sourceIds: [], calculationIds: ['other'] }],
      [calculation],
    )).toBe(false);
    expect(hasVisibleProvisionalPackageAmounts(
      [{ type: 'portion-calculator', observationIds: [], sourceIds: [], calculationIds: [calculation.id] }],
      [{ ...calculation, interpretationIds: [] }],
    )).toBe(false);
  });
});

describe('rejected package rechecks', () => {
  it('keeps a previously successful Gemini answer visible when a partial reconstruction is not promoted', () => {
    const previous: ThreadMessage = {
      question: 'Is this a good daily snack?', answer: 'The label suggests a high refined-flour content.',
      at: '2026-10-23T00:00:00.000Z', answerOrigin: 'gemini',
    };
    const pending: ThreadMessage = { ...previous, answer: '', status: 'pending' };
    const result = preservePreviousAnswerAfterRejectedRecheck(pending, previous, 'The alternate reading was incomplete.');

    expect(result.answer).toBe(previous.answer);
    expect(result.answerOrigin).toBe('gemini');
    expect(result.status).toBeUndefined();
  });

  it('shows a retry fallback when no successful earlier answer exists', () => {
    const pending: ThreadMessage = { question: 'Is this a good daily snack?', answer: '', at: '2026-10-23T00:00:00.000Z', status: 'pending', answerOrigin: 'gemini' };
    const result = preservePreviousAnswerAfterRejectedRecheck(pending, undefined, 'The alternate reading was incomplete.');

    expect(result.status).toBe('fallback');
    expect(result.statusDetail).toBe('The alternate reading was incomplete.');
    expect(result.answer).toBe('');
  });
});

describe('saved conversation turns', () => {
  it('omits pending turns and strips transient UI state and tool traces before persistence', () => {
    const messages: ThreadMessage[] = [
      { question: 'What is in this?', answer: '', at: '2026-10-23T00:00:00.000Z', status: 'pending', answerOrigin: 'gemini' },
      { question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', status: 'fallback', statusDetail: 'Retry Gemini', outdated: true, answerOrigin: 'local', agentTrace: [{ name: 'search_knowledge', status: 'ok', resultCount: 2, elapsedMs: 24 }] },
    ];

    expect(savedConversationTurns(messages)).toEqual([{
      question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', answerOrigin: 'local', outdated: true,
    }]);
  });

  it('keeps invalidation across saving and reopening while activating only the new revision answer', () => {
    const messages:ThreadMessage[]=[
      {question:'How much protein?',answer:'The earlier package reading gives 8 g.',at:'2026-10-25T00:00:00.000Z',uiComponents:[{type:'nutrition-table',observationIds:[],sourceIds:[],calculationIds:[]}]},
      {question:'Recheck the package.',answer:'The new reading gives 6 g.',at:'2026-10-25T00:01:00.000Z',outdated:true},
    ];
    const revised=supersedePackageAnswers(messages,messages[1].at);
    const reopened=savedConversationTurnSchema.array().parse(JSON.parse(JSON.stringify(savedConversationTurns(revised))));
    expect(reopened[0]).toMatchObject({question:messages[0].question,answer:messages[0].answer,outdated:true});
    expect(reopened[0].uiComponents).toBeUndefined();
    expect(reopened[1].outdated).toBe(false);
    expect(messages[0].uiComponents).toHaveLength(1);
  });

  it('persists only validated calculations needed by a contextual UI turn', () => {
    const calculation: Calculation = {
      id: 'calc-carbohydrate-20g', label: 'Carbohydrate in 20 g', nutrient: 'carbohydrate',
      input: 60, inputUnit: 'g', basisAmount: 100, portion: 20, portionUnit: 'g',
      result: 12, unit: 'g', formula: '60 g × 20 g ÷ 100 g', observationIds: ['label-row'], assumptions: ['Unverified interpretation.'],
    };
    const turns = savedConversationTurns([{
      question: 'How much carbohydrate in 20 g?', answer: 'About 12 g.', at: '2026-10-23T00:01:00.000Z',
      answerOrigin: 'gemini', calculations: [calculation],
    }]);

    expect(turns[0]?.calculations).toEqual([calculation]);
  });
});

describe('deterministic portion display', () => {
  const calculation: Calculation = {
    id: 'calc-carbohydrate-20g', label: 'Carbohydrate in 20 g', nutrient: 'carbohydrate',
    input: 60, inputUnit: 'g', basisAmount: 100, portion: 20, portionUnit: 'g',
    result: 12, unit: 'g', formula: '60 g × 20 g ÷ 100 g', observationIds: ['label-row'], assumptions: ['Unverified interpretation.'],
  };

  it('scales a returned calculation to another amount on the same basis', () => {
    expect(scaleCalculationToPortion(calculation, 30, 'g')).toBe(18);
  });

  it('does not convert between mass and volume without a density', () => {
    expect(scaleCalculationToPortion(calculation, 30, 'ml')).toBeNull();
  });
});

describe('operation-bound nutrition UI', () => {
  const reconstructionPackage = (corrected = false) => packageSchema.parse({
    id: 'package-1', name: 'Bisk Farm Cream Cracker', ingredients: [], additives: [], allergens: [], claims: [],
    nutrients: corrected ? [{ key: 'carbohydrate', value: 60, unit: 'g', basis: { amount: 100, unit: 'g', description: 'per 100 g' }, observationIds: ['correction-line'], status: 'corrected' }] : [],
    observations: [
      { id: 'serving-line', field: 'ocr-line', text: 'Serving size 2 biscuits approx 13.4 g', side: 'back', confidence: 90, origin: 'ocr', imageId: 'package-back' },
      { id: 'carbohydrate-line', field: 'ocr-line', text: 'Carbohydrates 69.29 g per 100 g', side: 'back', confidence: 90, origin: 'ocr', imageId: 'package-back' },
      ...(corrected ? [{ id: 'correction-line', field: 'nutrient-correction', text: 'Carbohydrate 60 g per 100 g', side: 'back' as const, confidence: null, origin: 'user' as const }] : []),
    ],
    rawText: 'Serving size 2 biscuits approx 13.4 g\nCarbohydrates 69.29 g per 100 g', warnings: [], synthetic: false, createdAt: '2026-10-24T00:00:00.000Z',
    reconstruction: {
      revision: 1, updatedAt: '2026-10-24T00:00:00.000Z', model: 'Gemini', current: true,
      identity: { brand: 'Bisk Farm', name: 'Cream Cracker', variant: null, status: 'provisional', evidence: { observationIds: ['serving-line'], imageRegions: [] } },
      serving: { printedText: '2 biscuits approx 13.4 g', quantity: 13.4, unit: 'g', pieceCount: 2, pieceDescription: 'biscuits', status: 'provisional', evidence: { observationIds: ['serving-line'], imageRegions: [] } },
      nutritionRows: [{ rowId: 'carbohydrate-row', nutrient: 'Carbohydrates', printedLabel: 'Carbohydrates', printedValue: '69.29 g', value: 69.29, unit: 'g', columnLabel: 'Per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: corrected ? 'conflict' : 'provisional', evidence: { observationIds: ['carbohydrate-line'], imageRegions: [] } }],
      ingredients: [], additives: [], statements: [], regions: [], unresolved: [], interpretationNote: 'Test package.'
    }
  });

  it('combines saved reconstruction with deterministic calculations without inventing widgets', () => {
    const table:AssistantUiComponent={ type: 'nutrition-table', observationIds: [], sourceIds: [], calculationIds: [] };
    const result = prepareAssistantTurnPresentation([table], [], reconstructionPackage());
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]).toMatchObject({ nutrient: 'carbohydrate', portion: 13.4, interpretationIds: ['carbohydrate-row'] });
    expect(result.calculations[0]?.result).toBeCloseTo(9.28486, 8);
    expect(result.components).toEqual([table]);
  });

  it('does not use a reconstructed amount after a user correction or a conflicting row', () => {
    const corrected = prepareAssistantTurnPresentation([], [], reconstructionPackage(true));
    expect(corrected.calculations).toEqual([]);
    expect(corrected.components).toEqual([]);
  });

  it('keeps a fresh corrected calculation but rejects the earlier model value', () => {
    const pkg=reconstructionPackage(true);
    const fresh:Calculation={id:'corrected-carb',label:'Carbohydrate in 20 g',nutrient:'carbohydrate',input:60,inputUnit:'g',basisAmount:100,portion:20,portionUnit:'g',result:12,unit:'g',formula:'60 × 20 ÷ 100',observationIds:['correction-line'],assumptions:[]};
    const stale:Calculation={...fresh,id:'old-carb',input:69.29,result:13.858,observationIds:['carbohydrate-line'],interpretationIds:['carbohydrate-row']};
    const component:AssistantUiComponent={type:'portion-calculator',observationIds:['correction-line'],sourceIds:[],calculationIds:[fresh.id]};
    const result=prepareAssistantTurnPresentation([component],[stale,fresh],pkg);
    expect(result.calculations).toEqual([fresh]);
    expect(result.components).toEqual([component]);
  });

  it('does not infer a calculator from wording or a saved calculation alone', () => {
    const servingCalculation: Calculation = {
      id: 'serving-carbohydrate', label: 'Carbohydrate per serving', nutrient: 'carbohydrate', input: 69.29, inputUnit: 'g', basisAmount: 100,
      portion: 13.4, portionUnit: 'g', result: 9.28486, unit: 'g', formula: '69.29 g × 13.4 g ÷ 100 g',
      observationIds: ['ocr-carbohydrate'], imageIds: ['package-back'], interpretationIds: ['carbohydrate-row'], assumptions: ['Unverified package interpretation.'],
    };
    const result = prepareAssistantTurnPresentation([], [servingCalculation], reconstructionPackage());
    expect(result.calculations).toContainEqual(servingCalculation);
    expect(result.components).toEqual([]);
  });

  it('shows the saved serving calculation for an exact piece-count follow-up', () => {
    const result = prepareAssistantTurnPresentation([], [], reconstructionPackage());
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]).toMatchObject({ nutrient: 'carbohydrate', portion: 13.4 });
    expect(result.calculations[0]?.result).toBeCloseTo(9.28486, 8);
    expect(result.components).toEqual([]);
  });

  it('recovers an explicitly printed serving from text when Gemini left its subfields unresolved', () => {
    const pkg=reconstructionPackage();
    pkg.reconstruction!.serving={
      printedText:'2 biscuits (approx. 13.4 g)',quantity:null,unit:null,pieceCount:null,pieceDescription:null,
      status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]},
    };
    const result=prepareAssistantTurnPresentation([],[],pkg);
    expect(result.calculations[0]).toMatchObject({nutrient:'carbohydrate',portion:13.4});
    expect(result.calculations[0]?.result).toBeCloseTo(9.28486,8);
    expect(result.components).toEqual([]);
  });

  it('keeps a traceable serving tool when the model proposes only inspector components', () => {
    const components: AssistantUiComponent[] = [
      'package-evidence', 'package-details', 'source-reference-cards',
      'package-evidence', 'package-details', 'source-reference-cards',
    ].map(type => ({ type: type as AssistantUiComponent['type'], observationIds: [], sourceIds: [], calculationIds: [] }));
    const result = prepareAssistantTurnPresentation(components, [], reconstructionPackage());
    expect(result.components).toEqual([]);
  });

  it('keeps the thread component list controlled by returned operations', () => {
    const servingCalculation: Calculation = {
      id: 'serving-carbohydrate', label: 'Carbohydrate per serving', nutrient: 'carbohydrate', input: 69.29, inputUnit: 'g', basisAmount: 100,
      portion: 13.4, portionUnit: 'g', result: 9.28486, unit: 'g', formula: '69.29 g × 13.4 g ÷ 100 g',
      observationIds: ['ocr-carbohydrate'], interpretationIds: ['carbohydrate-row'], assumptions: ['Unverified package interpretation.'],
    };
    expect(prepareAssistantTurnPresentation([], [servingCalculation], reconstructionPackage()).components).toEqual([]);
    const returned:AssistantUiComponent={type:'portion-calculator',observationIds:['ocr-carbohydrate'],sourceIds:[],calculationIds:['serving-carbohydrate']};
    expect(prepareAssistantTurnPresentation([returned],[servingCalculation],reconstructionPackage()).components).toEqual([returned]);
  });
});

describe('Gemini tool activity', () => {
  it('keeps only bounded, non-content trace metadata', () => {
    expect(parseThreadAgentTrace([
      { name: 'get_nutrition_guidance', status: 'ok', resultCount: 1, elapsedMs: 12 },
      { name: 'bad name', status: 'ok', resultCount: 1, elapsedMs: 12, prompt: 'private' },
      { name: 'search_knowledge', status: 'ok', resultCount: 1, elapsedMs: 12, query: 'private' },
    ])).toEqual([
      { name: 'get_nutrition_guidance', status: 'ok', resultCount: 1, elapsedMs: 12 },
      { name: 'search_knowledge', status: 'ok', resultCount: 1, elapsedMs: 12 },
    ]);
  });
});

describe('Gemini failure explanations', () => {
  it('separates Google rate or quota limits from the project spend guard', () => {
    expect(geminiFailureMessage('provider_rate_limited')).toMatch(/rate- or quota-limited/);
    expect(geminiFailureMessage('provider_rate_limited')).toMatch(/does not by itself mean the project spending limit was reached/i);
    expect(geminiFailureMessage('paid_spend_cap')).toMatch(/local Gemini spending guard/);
  });

  it('reports authentication, model and response-validation failures distinctly', () => {
    expect(geminiFailureMessage('provider_authentication_failed')).toMatch(/credentials/);
    expect(geminiFailureMessage('provider_model_unavailable')).toMatch(/model is unavailable/);
    expect(geminiFailureMessage('provider_invalid')).toMatch(/could not be read/i);
    expect(geminiFailureMessage('provider_incomplete')).toMatch(/could not finish/i);
    expect(geminiFailureMessage('provider_invalid_json')).toMatch(/not read as structured data/i);
    expect(geminiFailureMessage('provider_schema_invalid')).toMatch(/could not finish an answer NutriScan can use/i);
  });
});
