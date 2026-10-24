import { describe, expect, it } from 'vitest';
import { defaultProfile, packageSchema, savedConversationTurnSchema } from '../contracts';
import { buildAudit } from '../engine';
import { parseLabel } from '../parser';
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
    expect(reply.answer).not.toContain('WHO general adult reference');
    expect(reply.evidence?.map((item) => item.id)).toContain('who-sodium');

    const quantityOnly = buildLocalAuditConversationReply(audit, 'How much sodium is in a 20 g portion?');
    expect(quantityOnly.evidence).toBeUndefined();
    expect(quantityOnly.answer).not.toContain('WHO general adult reference');

    const unrelated = buildLocalAuditConversationReply(audit, 'What remains uncertain on this label?');
    expect(unrelated.evidence).toBeUndefined();
    expect(unrelated.answer).not.toContain('WHO general adult reference');
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
