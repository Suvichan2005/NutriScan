import { describe, expect, it } from 'vitest';
import { defaultProfile, packageSchema, savedConversationTurnSchema } from '../contracts';
import { buildAudit } from '../engine';
import { parseLabel } from '../parser';
import { selectCitedEvidence } from '../answer-evidence';
import {
  buildLocalEvidenceFollowUp,
  buildLocalEvidenceUnavailableFollowUp,
  buildLocalAuditConversationReply,
  buildLocalPackageFallbackReply,
  isGuidanceEvidenceInScope,
  isLocalEvidenceTopicallyRelevant,
  isSafeEvidenceUrl,
  parseLocalEvidenceResponse,
  safeConversationEvidence,
  shouldSearchLocalEvidence
} from '../followup-evidence';
import type { EvidenceSource } from '../contracts';

const source: EvidenceSource = {
  id: 'icmrnin-dgi-2024',
  title: 'Dietary Guidelines for Indians, Revised Edition 2024',
  publisher: 'ICMR-NIN',
  url: 'https://www.nin.res.in/dietaryguidelines.html',
  category: 'guideline',
  jurisdiction: 'India',
  publishedAt: '2024-01-01',
  effectiveAt: null,
  retrievedAt: '2026-10-22',
  summary: 'A curated summary of the 2024 dietary guidance.',
  limitations: 'General guidance; not a personal prescription.'
};

const retrievalResponse = (overrides: Record<string, unknown> = {}) => ({
  status: 'ok',
  mode: 'hybrid-local-embedding',
  model: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  corpusVersion: 'food-evidence-v1',
  corpusSha256: 'a'.repeat(64),
  retrievedAt: '2026-10-22T00:00:00.000Z',
  latencyMs: 12,
  requestId: '00000000-0000-4000-8000-000000000001',
  results: [{ source, semanticScore: 0.55, lexicalScore: 0.8, score: 0.57, exactIdentity: false }],
  limitations: ['Similarity is not a probability of truth.'],
  ...overrides
});

describe('local evidence follow-ups', () => {
  it('keeps clinical guidance aligned to India/global scope unless another country is requested or shared', () => {
    const usGuidance: EvidenceSource = {
      ...source,
      id: 'niddk-meals',
      title: 'Healthy Living with Diabetes',
      publisher: 'US National Institute of Diabetes and Digestive and Kidney Diseases',
      jurisdiction: 'United States; general diabetes education',
    };
    const globalGuidance: EvidenceSource = { ...source, id: 'who-global', jurisdiction: 'Global' };
    const indianGuidance: EvidenceSource = source;

    expect(isGuidanceEvidenceInScope(usGuidance, 'Is this suitable as a daily snack?')).toBe(false);
    expect(isGuidanceEvidenceInScope(usGuidance, 'Compare with U.S. diabetes guidance.')).toBe(true);
    expect(isGuidanceEvidenceInScope(usGuidance, 'Is this suitable as a daily snack?', 'United States')).toBe(true);
    expect(isGuidanceEvidenceInScope(globalGuidance, 'Is this suitable as a daily snack?')).toBe(true);
    expect(isGuidanceEvidenceInScope(indianGuidance, 'Is this suitable as a daily snack?')).toBe(true);
    expect(isGuidanceEvidenceInScope({ ...usGuidance, category: 'literature' }, 'Is this suitable as a daily snack?')).toBe(true);
  });

  it('routes a genuinely unsupported follow-up to retrieval, but leaves package answers on the local path', () => {
    const pkg = parseLabel('Product: Test food', { origin: 'user' });
    const broad = buildAudit(pkg, 100, 'g', defaultProfile, 'What does ICMR-NIN 2024 say about healthy meal planning?');
    const packageQuestion = buildAudit(pkg, 100, 'g', defaultProfile, 'How much sodium is in this package?');

    expect(broad.trace.some((item) => /unsupported local question/i.test(item.reason))).toBe(true);
    expect(shouldSearchLocalEvidence(broad)).toBe(true);
    expect(shouldSearchLocalEvidence(packageQuestion)).toBe(false);
  });

  it('validates the shared response, deduplicates safe sources and rejects unsafe destinations', () => {
    const duplicate = { ...source };
    const parsed = parseLocalEvidenceResponse(retrievalResponse({
      results: [
        { source, semanticScore: 0.55, lexicalScore: 0.8, score: 0.57, exactIdentity: false },
        { source: duplicate, semanticScore: 0.4, lexicalScore: 0.2, score: 0.38, exactIdentity: false },
        { source: { ...source, id: 'private-link', url: 'https://192.168.1.3/reference' }, semanticScore: 0.4, lexicalScore: 0.2, score: 0.38, exactIdentity: false }
      ]
    }));

    expect(parsed.hits.map((hit) => hit.source.id)).toEqual([source.id]);
    expect(isSafeEvidenceUrl('https://example.org/reference')).toBe(true);
    expect(isSafeEvidenceUrl('http://example.org/reference')).toBe(false);
    expect(isSafeEvidenceUrl('https://user:pass@example.org/reference')).toBe(false);
    expect(isSafeEvidenceUrl('https://127.0.0.1/reference')).toBe(false);
    expect(() => parseLocalEvidenceResponse(retrievalResponse({ latencyMs: -1 }))).toThrow();
    expect(() => parseLocalEvidenceResponse(retrievalResponse({ requestId: 'not-an-id' }))).toThrow();
  });

  it('keeps exact identity matches but withholds broad semantic near-matches for named substances', () => {
    const genericFibreSource: EvidenceSource = {
      ...source,
      id: 'general-fibre',
      title: 'Dietary fibre in food',
      summary: 'General information about dietary fibre and digestive health.',
    };
    const oligofructoseSource: EvidenceSource = {
      ...source,
      id: 'oligofructose-review',
      title: 'Oligofructose assessment',
      summary: 'Evidence on oligofructose intake and digestive effects.',
    };
    const query = 'What evidence describes oligofructose in food, dietary fibre, digestion and amount?';

    expect(isLocalEvidenceTopicallyRelevant(genericFibreSource, query)).toBe(false);
    expect(isLocalEvidenceTopicallyRelevant(oligofructoseSource, query)).toBe(true);
    expect(isLocalEvidenceTopicallyRelevant(genericFibreSource, 'oligofructose', true)).toBe(true);

    const filtered = parseLocalEvidenceResponse(retrievalResponse({ results: [
      { source: genericFibreSource, semanticScore: 0.9, lexicalScore: 0.5, score: 0.8, exactIdentity: false },
    ] }), query);
    expect(filtered.status).toBe('no_match');
    expect(filtered.hits).toEqual([]);
    expect(filtered.message).toMatch(/topical relevance and jurisdiction/i);
  });

  it('retains a source matching one requested topic when a multi-part query adds unrelated context', () => {
    const sodium: EvidenceSource = {
      ...source,
      id: 'who-sodium',
      title: 'Sodium reduction',
      publisher: 'World Health Organization',
      jurisdiction: 'Global; general adult population',
      summary: 'WHO recommends adults consume less than 2000 mg sodium daily. One gram of salt corresponds to 400 mg sodium.',
    };
    const query = 'hypertension sodium salt intake';

    expect(isLocalEvidenceTopicallyRelevant(sodium, query)).toBe(true);
    expect(parseLocalEvidenceResponse(retrievalResponse({ results: [
      { source: sodium, semanticScore: 0.7, lexicalScore: 0.6, score: 0.68, exactIdentity: false },
    ] }), query).hits.map(hit => hit.source.id)).toEqual(['who-sodium']);

    const contextualQuestion = 'I have type 2 diabetes and hypertension. For this 75 g portion, what does the sodium mean, and what should I compare without a personal target?';
    const pkg = parseLabel('Instant noodles\nNutrition information per 100 g\nSodium 1400 mg', { origin: 'user' });
    const audit = buildAudit(pkg, 75, 'g', defaultProfile, contextualQuestion);
    const reply = buildLocalAuditConversationReply(audit, contextualQuestion, pkg);
    expect(reply.answer).toContain('1050 mg sodium');
    expect(reply.answer).toContain('52.5% of the WHO general adult reference');
    expect(reply.answer).toMatch(/not a personal sodium allowance/i);
    expect(reply.evidence?.map(item => item.id)).toContain('who-sodium');
  });

  it('does not confuse an additive identity with a requested nutrition-panel value', () => {
    const calciumEdta: EvidenceSource = {
      ...source,
      id: 'jefca-calcium-disodium-edta',
      title: 'JECFA additive identity: Calcium Disodium EDTA (385)',
      publisher: 'Joint FAO/WHO Expert Committee on Food Additives',
      category: 'registry',
      summary: 'Calcium disodium EDTA is an additive identity used in food specifications.',
    };
    const query = 'Is calcium listed?';
    expect(isLocalEvidenceTopicallyRelevant(calciumEdta, query)).toBe(false);
    expect(parseLocalEvidenceResponse(retrievalResponse({ results: [
      { source: calciumEdta, semanticScore: 0.95, lexicalScore: 0.9, score: 0.93, exactIdentity: false },
    ] }), query).hits).toEqual([]);
    expect(isLocalEvidenceTopicallyRelevant(calciumEdta, 'What is calcium disodium EDTA additive?')).toBe(true);
  });

  it('withholds an otherwise matching source that explicitly excludes the asked population', () => {
    const guidance: EvidenceSource = {
      ...source,
      id: 'who-sweeteners',
      title: 'Use of non-sugar sweeteners: WHO guideline',
      jurisdiction: 'Global; prevention guidance excludes existing diabetes',
      summary: 'Conditional recommendation against use for prevention; it excludes people with pre-existing diabetes.',
    };

    expect(isLocalEvidenceTopicallyRelevant(guidance, 'diabetes daily snack', true)).toBe(false);
    expect(parseLocalEvidenceResponse(retrievalResponse({ results: [
      { source: guidance, semanticScore: 0.9, lexicalScore: 0.8, score: 0.86, exactIdentity: true },
    ] }), 'diabetes daily snack').hits).toEqual([]);
  });

  it('applies India-first guidance scope to local results while preserving an explicitly requested jurisdiction', () => {
    const usGuidance: EvidenceSource = {
      ...source,
      id: 'niddk-diabetes-meals',
      title: 'Diabetes meal planning',
      publisher: 'US National Institute of Diabetes and Digestive and Kidney Diseases',
      jurisdiction: 'United States',
      summary: 'General meal planning for diabetes.',
    };
    const payload = retrievalResponse({ results: [
      { source: usGuidance, semanticScore: 0.9, lexicalScore: 0.8, score: 0.86, exactIdentity: false },
    ] });

    expect(parseLocalEvidenceResponse(payload, 'diabetes meal planning').hits).toEqual([]);
    expect(parseLocalEvidenceResponse(payload, 'diabetes meal planning', 'United States').hits.map(hit => hit.source.id)).toEqual(['niddk-diabetes-meals']);
  });

  it('keeps source candidates tentative in the reply and distinguishes no-match from missing evidence', () => {
    const answer = buildLocalEvidenceFollowUp('The package alone does not answer this.', [source]);
    expect(answer).toContain(source.title);
    expect(answer).not.toContain(source.summary);
    expect(answer).toContain('Review its jurisdiction and scope there');

    const noMatch = buildLocalEvidenceFollowUp('The package alone does not answer this.', []);
    expect(noMatch).toContain('No strong match came from the local evidence library');
    expect(noMatch).toContain('does not mean relevant evidence does not exist');
    expect(buildLocalEvidenceUnavailableFollowUp('The package alone does not answer this.'))
      .toContain('remains a package-only response');
  });

  it('puts only source-linked audit context and safe citations into a local conversation reply', () => {
    const pkg = parseLabel('Nutrition information per 100 g\nSodium 2283 mg', { origin: 'user' });
    const comparisonQuestion = 'How does this 20 g serving compare with WHO daily adult sodium guidance?';
    const audit = buildAudit(pkg, 20, 'g', defaultProfile, comparisonQuestion);
    const reply = buildLocalAuditConversationReply(audit, comparisonQuestion);

    expect(reply.answer).toContain('456.6 mg sodium');
    expect(reply.answer).toContain('WHO general adult reference');
    expect(reply.answer).toContain('not a personal sodium allowance');
    expect(reply.evidence?.map((item) => item.id)).toContain('who-sodium');

    const quantityOnly = buildLocalAuditConversationReply(audit, 'How much sodium is in a 20 g portion?');
    expect(quantityOnly.evidence).toBeUndefined();
    expect(quantityOnly.answer).not.toContain('WHO general adult reference');

    const unrelated = buildLocalAuditConversationReply(audit, 'What remains uncertain on this label?');
    expect(unrelated.evidence).toBeUndefined();
    expect(unrelated.answer).not.toContain('WHO general adult reference');
  });

  it('preserves a complete source-backed answer for a direct guidance question', () => {
    const pkg = parseLabel([
      'Synthetic evaluation label',
      'Serving size 30 g',
      'Nutrition information per 100 g',
      'Fibre 8 g',
    ].join('\n'), { origin: 'user' });
    const question = 'What does WHO recommend about dietary fibre?';
    const reply = buildLocalAuditConversationReply(buildAudit(pkg, 30, 'g', defaultProfile, question), question, pkg);

    expect(reply.evidence?.map(item => item.id)).toContain('who-carbohydrate-2023');
    expect(reply.answer).toContain('at least 25 g/day of naturally occurring dietary fibre');
    expect(reply.answer).toContain('not a product-specific threshold or individual prescription');
    expect(reply.answer).toContain('2.4 g fibre in 30 g');

    const claimPackage = parseLabel('Nutrition information per 100 g\nProtein 10 g\nHigh protein', { origin: 'user' });
    const claimQuestion = 'What does the High protein claim mean?';
    const claimReply = buildLocalAuditConversationReply(buildAudit(claimPackage, 30, 'g', defaultProfile, claimQuestion), claimQuestion, claimPackage);
    expect(claimReply.evidence?.length).toBeGreaterThan(0);
    expect(claimReply.answer).toContain('at least 20% of RDA per 100 g for solids');
    expect(claimReply.answer).toMatch(/establish whether the product makes or meets the claim/i);

    const allergenPackage = parseLabel('Ingredients: Oats, salt\nMay contain traces of peanuts', { origin: 'user' });
    const allergenQuestion = 'How should I interpret the May contain traces of peanuts statement?';
    const allergenReply = buildLocalAuditConversationReply(buildAudit(allergenPackage, 30, 'g', defaultProfile, allergenQuestion), allergenQuestion, allergenPackage);
    expect(allergenReply.evidence?.map(item => item.id)).toContain('fssai-labelling-allergen-faq-2023');
    expect(allergenReply.answer).toContain('does not establish actual allergen presence');
    expect(allergenReply.answer).toContain('FAQ on Food Safety and Standards (Labelling & Display) Regulations, 2020');
    expect(selectCitedEvidence(allergenReply.answer, allergenReply.evidence ?? []).map(item => item.id)).toContain('fssai-labelling-allergen-faq-2023');

    const transFatPackage = parseLabel('Nutrition information per 100 g\nTrans fat 0 g\nIngredients: wheat flour, vegetable oil, salt', { origin: 'user' });
    const transFatQuestion = 'What does the trans fat line mean?';
    const transFatReply = buildLocalAuditConversationReply(buildAudit(transFatPackage, 30, 'g', defaultProfile, transFatQuestion), transFatQuestion, transFatPackage);
    expect(transFatReply.answer).toContain('WHO describes trans-fatty acids');
    expect(transFatReply.answer).toMatch(/“Trans fat 0 g” \(user-entered observation\).*not verified facts/i);
    expect(transFatReply.answer).toMatch(/does not establish a numeric amount, zero, or a portion calculation/i);
    expect(transFatReply.evidence?.map(item => item.id)).toEqual(expect.arrayContaining(['who-trans-fat-2024', 'fssai-industrial-trans-fat-2021']));

    const currentLawQuestion = 'What is the current FSSAI law for trans fat?';
    const currentLawReply = buildLocalAuditConversationReply(buildAudit(transFatPackage, 30, 'g', defaultProfile, currentLawQuestion), currentLawQuestion, transFatPackage);
    expect(currentLawReply.answer).toMatch(/Current legal or regulatory status is unresolved/i);
    expect(currentLawReply.answer).toMatch(/exact product and jurisdiction/i);
  });

  it('states when a requested nutrient is unrecorded and combines linked allergy uncertainty with portion facts', () => {
    const pkg = parseLabel([
      'Synthetic evaluation label',
      'Nutrition information per 100 g',
      'Carbohydrate 60 g',
      'Sodium 760 mg',
      'Ingredients: Oats, milk powder, salt',
      'Contains: Milk',
      'May contain traces of peanuts',
    ].join('\n'), { origin: 'user' });
    const missingQuestion = 'Is calcium listed?';
    const missing = buildLocalAuditConversationReply(
      buildAudit(pkg, 30, 'g', defaultProfile, missingQuestion), missingQuestion, pkg,
    );
    expect(missing.answer).toMatch(/No calcium amount is recorded in the label text entered so far/i);
    expect(missing.answer).toMatch(/does not establish that the package contains none/i);
    expect(missing.answer).not.toMatch(/(?:0|zero)\s*mg/i);

    const combinedQuestion = 'Is this suitable with my peanut allergy and diabetes?';
    const profile = { ...defaultProfile, allergies: 'peanuts', healthConsiderations: 'type 2 diabetes' };
    const combined = buildLocalAuditConversationReply(
      buildAudit(pkg, 30, 'g', profile, combinedQuestion), combinedQuestion, pkg,
    );
    expect(combined.answer).toContain('18 g carbohydrate');
    expect(combined.answer).toContain('May-contain precautionary wording');
    expect(combined.answer).toMatch(/does not establish actual allergen presence.*individual risk or safety/i);
    expect(combined.answer).toMatch(/cannot establish individual suitability/i);
    expect(combined.evidence).toBeUndefined();
  });

  it('preserves the missing-ingredient caveat and next step in a natural follow-up',()=>{
    const pkg=parseLabel('Nutrition information per 100 g\nSugars 10 g',{origin:'user'});
    const question='What ingredients are listed?';
    const reply=buildLocalAuditConversationReply(buildAudit(pkg,30,'g',defaultProfile,question),question,pkg);
    expect(reply.answer).toMatch(/No readable ingredient text is recorded.*does not establish that the package has none/i);
    expect(reply.answer).toMatch(/add or check a clear photo of the relevant panel/i);
  });

  it('does not paste US-only diabetes education into the local fallback for an Indian-market snack question', () => {
    const pkg = parseLabel('Bisk Farm Sugar Free Cream Cracker\nIngredients: Refined wheat flour (maida) (89.98%)', { origin: 'user' });
    const question = 'Is this good to have for diabetic patients daily for snacking?';
    const audit = buildAudit(pkg, 26.8, 'g', defaultProfile, question);
    const reply = buildLocalAuditConversationReply(audit, question);

    expect(reply.answer).not.toMatch(/NIDDK|United States|not everyone with diabetes/i);
    expect(reply.evidence?.some(item => item.jurisdiction.startsWith('United States'))).not.toBe(true);
  });

  it('summarizes only linked reconstructed package details and keeps provisional readings distinct on a cloud failure', () => {
    const base = parseLabel('Example crackers\nNutrition information per 100 g\nCarbohydrates 69.29 g', { origin: 'user' });
    const observationId = base.observations[0].id;
    const linked = { observationIds: [observationId], imageRegions: [] };
    const pkg = packageSchema.parse({
      ...base,
      reconstruction: {
        revision: 1, updatedAt: '2026-10-24T00:00:00.000Z', model: 'test-model', current: true,
        identity: { brand: 'Example', name: 'Crackers', variant: null, status: 'provisional', evidence: linked },
        serving: { printedText: '2 crackers (about 13.4 g)', quantity: 13.4, unit: 'g', pieceCount: 2, pieceDescription: 'crackers', status: 'provisional', evidence: linked },
        nutritionRows: [{ rowId: 'carbohydrate', nutrient: 'carbohydrate', printedLabel: 'Carbohydrates', printedValue: '69.29', value: 69.29, unit: 'g', columnLabel: 'per 100 g', basisText: 'per 100 g', basisAmount: 100, basisUnit: 'g', qualifier: null, status: 'provisional', evidence: linked }],
        ingredients: [{ position: 0, name: 'Refined wheat flour (maida)', printedText: 'Refined wheat flour (maida) (89.98%)', printedPercentage: 89.98, normalizedName: 'refined wheat flour', status: 'provisional', evidence: linked }],
        additives: [],
        statements: [{ kind: 'claim', label: null, text: 'Sugar free', status: 'provisional', evidence: linked }],
        regions: [], unresolved: [], interpretationNote: 'Provisional test interpretation.'
      }
    });
    const question = 'Is this good to have daily for snacking?';
    const audit = buildAudit(pkg, 13.4, 'g', defaultProfile, question);
    const provisionalAudit = { ...audit, calculations: audit.calculations.map(calculation => ({ ...calculation, interpretationIds: ['candidate-carbohydrate'], imageIds: ['package-back'] })) };
    const reply = buildLocalPackageFallbackReply(provisionalAudit, question, pkg);

    expect(reply.answer).toContain('Refined wheat flour (maida) (printed 89.98%)');
    expect(reply.answer).toContain('Sugar free');
    expect(reply.answer).toContain('2 crackers (about 13.4 g)');
    expect(reply.answer).toMatch(/9\.28 g carbohydrate.*provisional image reading/);
    expect(reply.answer).toContain('does not determine individual suitability');
    expect(reply.answer).not.toMatch(/causes? a glucose spike|medically safe|daily carbohydrate limit/i);
    expect(reply.answer).not.toContain('Nutrition information per 100 g');
  });

  it('reports requested nutrients without substitutions or collapsing added and total sugars', () => {
    const pkg = parseLabel([
      'Synthetic cracker label',
      'Nutrition information per 100 g',
      'Carbohydrate 60 g',
      'Sugars 4 g',
      'Sodium 760 mg',
    ].join('\n'), { origin: 'user' });
    const question = 'How much carbohydrate and sodium are in a 30 g portion?';
    const reply = buildLocalPackageFallbackReply(buildAudit(pkg, 30, 'g', defaultProfile, question), question, pkg);

    expect(reply.answer).toContain('18 g carbohydrate for 30 g');
    expect(reply.answer).toContain('228 mg sodium for 30 g');

    const missingQuestion = 'How much protein and sodium are in a 30 g portion?';
    const missingReply = buildLocalPackageFallbackReply(
      buildAudit(pkg, 30, 'g', defaultProfile, missingQuestion), missingQuestion, pkg,
    );
    expect(missingReply.answer).toContain('228 mg sodium for 30 g');
    expect(missingReply.answer).toMatch(/No protein amount is recorded.*does not establish that the package contains none/i);
    expect(missingReply.answer.includes('18 g carbohydrate')).toBe(false);

    const distinctNutrientQuestion = 'How much added sugar and total sugars are in a 30 g portion?';
    const distinctNutrientReply = buildLocalPackageFallbackReply(
      buildAudit(pkg, 30, 'g', defaultProfile, distinctNutrientQuestion), distinctNutrientQuestion, pkg,
    );
    expect(distinctNutrientReply.answer).toMatch(/No added sugar amount is recorded.*does not establish that the package contains none/i);
    expect(distinctNutrientReply.answer).toContain('1.2 g sugars for 30 g');
    expect(distinctNutrientReply.answer.includes('1.2 g added sugar')).toBe(false);
  });

  it('bounds restored conversation citations and removes unsafe links', () => {
    const sources = safeConversationEvidence([
      source,
      { ...source, id: 'bad-url', url: 'javascript:alert(1)' },
      ...Array.from({ length: 4 }, (_, index) => ({ ...source, id: 'extra-' + index }))
    ]);
    expect(sources.map((item) => item.id)).toEqual([source.id, 'extra-0', 'extra-1']);
    const turn = { question: 'Why this source?', answer: 'A local source was surfaced.', at: '2026-10-22T00:00:00.000Z' };
    expect(savedConversationTurnSchema.parse({ ...turn, evidence: sources }).evidence).toEqual(sources);
    expect(savedConversationTurnSchema.safeParse({ ...turn, evidence: [...sources, source] }).success).toBe(false);
    expect(savedConversationTurnSchema.safeParse({ ...turn, evidence: [{ ...source, summary: 'x'.repeat(1601) }] }).success).toBe(false);
  });
});
