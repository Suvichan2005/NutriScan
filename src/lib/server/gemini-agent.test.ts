import { describe, expect, it } from 'vitest';
import { packageSchema } from '../contracts';
import { validateInferenceOutput } from '../../modules/inference/core';
import { evidenceSources } from '../../modules/knowledge';
import { attachGoogleGrounding, googleGroundingEvidence, needsConversationalAnswerRepair, normalizeModelImageRegions, normalizeProviderAssistOutput, parseAgentProviderOutput, requestedIngredientIdentityCoverageFacts, requiresExplicitNutritionGuidanceLookup, supplementRequestedCompositionCoverage, supplementRequestedIngredientIdentityCoverage, supplementRequestedNutritionGuidanceCoverage, toolResultForModel, type RetrievedCompositionFact } from './gemini';
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
});

describe('model answer-part recovery', () => {
  it('uses one repair when answer parts are absent or some grounded evidence was omitted', () => {
    expect(needsConversationalAnswerRepair(1, 2, true, false)).toBe(true);
    expect(needsConversationalAnswerRepair(0, 4, true, false)).toBe(true);
    expect(needsConversationalAnswerRepair(1, 0, true, false)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 4, true, true)).toBe(false);
    expect(needsConversationalAnswerRepair(0, 0, false, false)).toBe(false);
  });

  it('keeps valid evidence-linked claims when only answer-to-claim indexes are malformed', () => {
    const output = normalizeProviderAssistOutput({
      answer: 'A supported label statement.',
      answerParts: [{ text: 'A supported label statement.', claimIndexes: [20] }],
      claims: [{
        mode: 'synthesis', text: 'The ingredient list names refined wheat flour.',
        observationIds: ['ocr-ingredients'], sourceIds: [], calculationIds: [], profileFieldIds: [],
        supportingSpans: [{ kind: 'observation', id: 'ocr-ingredients', quote: 'INGREDIENTS: REFINED WHEAT FLOUR' }],
        visualEvidence: [],
      }],
      limitations: [], inspectImage: null,
    });

    expect(output?.claims).toHaveLength(1);
    expect(output?.answerParts).toBeUndefined();
  });

  it('retains schema-valid empty evidence output for the caller to classify as unsupported quality', () => {
    const output = normalizeProviderAssistOutput({ answer: 'Unsupported prose.', answerParts: [], claims: [], limitations: [], inspectImage: null });
    expect(output?.claims).toEqual([]);
    expect(output?.answerParts).toBeUndefined();
  });
});

describe('Gemini final-response failure classification', () => {
  it('keeps no grounded claims, invalid JSON and schema failure as distinct outcomes', () => {
    const noClaims = parseAgentProviderOutput(JSON.stringify({ answer: 'Text without linked claims.', claims: [], limitations: [], inspectImage: null }));
    let malformedJsonError: unknown;
    try { parseAgentProviderOutput('{not json'); } catch (error) { malformedJsonError = error; }
    let schemaError: unknown;
    try { parseAgentProviderOutput(JSON.stringify({ answer: 'bad schema', claims: 'not an array', limitations: [], inspectImage: null })); } catch (error) { schemaError = error; }

    expect(noClaims.modelOutputStatus).toBe('no-grounded-claims');
    expect(noClaims.output.claims).toEqual([]);
    expect(malformedJsonError).toMatchObject({ code: 'provider_invalid_json', status: 502 });
    expect(schemaError).toMatchObject({ code: 'provider_schema_invalid', status: 502 });
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
