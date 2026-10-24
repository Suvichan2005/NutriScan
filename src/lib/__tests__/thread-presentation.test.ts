import { describe, expect, it } from 'vitest';
import { addContextualServingCalculator, geminiFailureMessage, hasVisibleProvisionalPackageAmounts, includeTraceableServingCalculation, mergeRecheckedPackageCandidates, packageDisplayIdentity, parseThreadAgentTrace, prepareAssistantTurnPresentation, preservePreviousAnswerAfterRejectedRecheck, savedConversationTurns, scaleCalculationToPortion, shouldShowLabelExplorer, shouldShowNutritionTable, type ThreadMessage } from '../thread-presentation';
import { packageSchema, type AssistantUiComponent, type Calculation, type TentativeStructuredCandidate } from '../contracts';

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
      question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', answerOrigin: 'local',
    }]);
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

describe('contextual nutrition UI', () => {
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

  it('combines saved reconstruction with a serving calculation and inserts it contextually', () => {
    const result = prepareAssistantTurnPresentation('Is this good for daily snacking?', [{ type: 'nutrition-table', observationIds: [], sourceIds: [], calculationIds: [] }], [], reconstructionPackage());
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]).toMatchObject({ nutrient: 'carbohydrate', portion: 13.4, interpretationIds: ['carbohydrate-row'] });
    expect(result.calculations[0]?.result).toBeCloseTo(9.28486, 8);
    expect(result.components.map(component => component.type)).toEqual(['nutrition-table', 'portion-calculator']);
    expect(result.components[1]?.calculationIds).toEqual([result.calculations[0]?.id]);
  });

  it('does not use a reconstructed amount after a user correction or a conflicting row', () => {
    const corrected = prepareAssistantTurnPresentation('Is this good for daily snacking?', [], [], reconstructionPackage(true));
    expect(corrected.calculations).toEqual([]);
    expect(corrected.components).toEqual([]);
  });

  it('adds a compact serving calculator when a food-choice answer has a linked carbohydrate calculation', () => {
    const servingCalculation: Calculation = {
      id: 'serving-carbohydrate', label: 'Carbohydrate per serving', nutrient: 'carbohydrate', input: 69.29, inputUnit: 'g', basisAmount: 100,
      portion: 13.4, portionUnit: 'g', result: 9.28486, unit: 'g', formula: '69.29 g × 13.4 g ÷ 100 g',
      observationIds: ['ocr-carbohydrate'], imageIds: ['package-back'], interpretationIds: ['carbohydrate-row'], assumptions: ['Unverified package interpretation.'],
    };
    const result = addContextualServingCalculator('Is this good for daily snacking?', [], [servingCalculation], { quantity: 13.4, unit: 'g', status: 'provisional' });
    expect(result).toEqual([{ type: 'portion-calculator', observationIds: ['ocr-carbohydrate'], sourceIds: [], calculationIds: ['serving-carbohydrate'] }]);
  });

  it('shows the saved serving calculation for an exact piece-count follow-up', () => {
    const result = prepareAssistantTurnPresentation('What about just two biscuits?', [], [], reconstructionPackage());
    expect(result.calculations).toHaveLength(1);
    expect(result.calculations[0]).toMatchObject({ nutrient: 'carbohydrate', portion: 13.4 });
    expect(result.calculations[0]?.result).toBeCloseTo(9.28486, 8);
    expect(result.components).toEqual([{ type: 'portion-calculator', observationIds: ['carbohydrate-line'], sourceIds: [], calculationIds: [result.calculations[0]!.id] }]);
  });

  it('recovers an explicitly printed serving from text when Gemini left its subfields unresolved', () => {
    const pkg=reconstructionPackage();
    pkg.reconstruction!.serving={
      printedText:'2 biscuits (approx. 13.4 g)',quantity:null,unit:null,pieceCount:null,pieceDescription:null,
      status:'provisional',evidence:{observationIds:['serving-line'],imageRegions:[]},
    };
    const result=prepareAssistantTurnPresentation('What about just two biscuits?',[],[],pkg);
    expect(result.calculations[0]).toMatchObject({nutrient:'carbohydrate',portion:13.4});
    expect(result.calculations[0]?.result).toBeCloseTo(9.28486,8);
    expect(result.components).toEqual([{type:'portion-calculator',observationIds:['carbohydrate-line'],sourceIds:[],calculationIds:[result.calculations[0]!.id]}]);
    expect(includeTraceableServingCalculation('The serving size is 2 biscuits (approximately 13.4 g).','What about just two biscuits?',result.calculations,pkg.reconstruction!.serving))
      .toBe('The serving size is 2 biscuits (approximately 13.4 g). With the current unverified label reading, that serving works out to about 9.28 g of carbohydrate.');
  });

  it('keeps a traceable serving tool when the model proposes only inspector components', () => {
    const components: AssistantUiComponent[] = [
      'package-evidence', 'package-details', 'source-reference-cards',
      'package-evidence', 'package-details', 'source-reference-cards',
    ].map(type => ({ type: type as AssistantUiComponent['type'], observationIds: [], sourceIds: [], calculationIds: [] }));
    const result = prepareAssistantTurnPresentation('What about just two biscuits?', components, [], reconstructionPackage());
    expect(result.components).toEqual([{ type: 'portion-calculator', observationIds: ['carbohydrate-line'], sourceIds: [], calculationIds: [result.calculations[0]!.id] }]);
  });

  it('fills a missing numeric carbohydrate answer from the traceable serving calculation', () => {
    const result = prepareAssistantTurnPresentation('What about just two biscuits?', [], [], reconstructionPackage());
    expect(includeTraceableServingCalculation(
      'The printed serving is 2 biscuits, approximately 13.4 g.',
      'What about just two biscuits?', result.calculations, reconstructionPackage().reconstruction!.serving,
    )).toBe('The printed serving is 2 biscuits, approximately 13.4 g. With the current unverified label reading, that serving works out to about 9.28 g of carbohydrate.');
    expect(includeTraceableServingCalculation(
      'The serving has about 9.28 g carbohydrate.',
      'What about just two biscuits?', result.calculations, reconstructionPackage().reconstruction!.serving,
    )).toBe('The serving has about 9.28 g carbohydrate.');
  });

  it('does not add a serving calculator for unrelated questions, unsupported calculations, or conflicted servings', () => {
    const servingCalculation: Calculation = {
      id: 'serving-carbohydrate', label: 'Carbohydrate per serving', nutrient: 'carbohydrate', input: 69.29, inputUnit: 'g', basisAmount: 100,
      portion: 13.4, portionUnit: 'g', result: 9.28486, unit: 'g', formula: '69.29 g × 13.4 g ÷ 100 g',
      observationIds: ['ocr-carbohydrate'], interpretationIds: ['carbohydrate-row'], assumptions: ['Unverified package interpretation.'],
    };
    const serving = { quantity: 13.4, unit: 'g' as const, status: 'provisional', pieceCount: null, pieceDescription: null };
    expect(addContextualServingCalculator('What is INS 319?', [], [servingCalculation], serving)).toEqual([]);
    expect(addContextualServingCalculator('Is this a good daily snack?', [], [{ ...servingCalculation, interpretationIds: [] }], serving)).toEqual([]);
    expect(addContextualServingCalculator('Is this a good daily snack?', [], [servingCalculation], { ...serving, status: 'conflict' })).toEqual([]);
  });

  it('keeps the full nutrition table out of normal suitability and portion answers', () => {
    expect(shouldShowNutritionTable('Is this good to have daily for snacking?', 1)).toBe(false);
    expect(shouldShowNutritionTable('Is this good to have daily for snacking?', 10)).toBe(false);
    expect(shouldShowNutritionTable('What about just two biscuits?', 10)).toBe(false);
    expect(shouldShowNutritionTable('What is this package?', 2)).toBe(false);
  });

  it('keeps the full table available when the user asks to inspect nutrition', () => {
    expect(shouldShowNutritionTable('Can you show the nutrition table?', 1)).toBe(true);
    expect(shouldShowNutritionTable('Can you show the nutrition table?', 0)).toBe(false);
    expect(shouldShowNutritionTable('Can you show the nutrition table?', 0, 2)).toBe(true);
    expect(shouldShowNutritionTable('How much carbohydrate is in two biscuits?', 1)).toBe(false);
  });

  it('shows ingredient context for suitability questions and explicit ingredient requests', () => {
    expect(shouldShowLabelExplorer('Is this good for daily snacking?', 'ingredient')).toBe(true);
    expect(shouldShowLabelExplorer('What ingredients and additives are listed?', 'ingredient')).toBe(true);
    expect(shouldShowLabelExplorer('What ingredients are in this?', 'ingredient')).toBe(true);
    expect(shouldShowLabelExplorer('What is the package weight?', 'ingredient')).toBe(false);
    expect(shouldShowLabelExplorer('Does this contain an allergen?', 'allergen')).toBe(true);
    expect(shouldShowLabelExplorer('Show me the nutrition table.', 'allergen')).toBe(false);
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
