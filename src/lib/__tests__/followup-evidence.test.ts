import { describe, expect, it } from 'vitest';
import { savedConversationTurnSchema } from '../contracts';
import {
  isGuidanceEvidenceInScope,
  isLocalEvidenceTopicallyRelevant,
  isSafeEvidenceUrl,
  parseLocalEvidenceResponse,
  safeConversationEvidence,
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

  it('bounds restored conversation citations and removes unsafe links', () => {
    const sources = safeConversationEvidence([
      source,
      { ...source, id: 'bad-url', url: 'javascript:alert(1)' },
      ...Array.from({ length: 4 }, (_, index) => ({ ...source, id: 'extra-' + index }))
    ]);
    expect(sources.map((item) => item.id)).toEqual([source.id, 'extra-0', 'extra-1']);
    const retrieved=safeConversationEvidence([source,...Array.from({length:9},(_,index)=>({...source,id:`retrieved-${index}`}))],8);
    expect(retrieved).toHaveLength(8);
    expect(retrieved.at(-1)?.id).toBe('retrieved-6');
    const turn = { question: 'Why this source?', answer: 'A local source was surfaced.', at: '2026-10-22T00:00:00.000Z' };
    expect(savedConversationTurnSchema.parse({ ...turn, evidence: sources }).evidence).toEqual(sources);
    expect(savedConversationTurnSchema.parse({ ...turn, retrievedEvidence: retrieved }).retrievedEvidence).toEqual(retrieved);
    expect(savedConversationTurnSchema.safeParse({ ...turn, retrievedEvidence: [...retrieved, source] }).success).toBe(false);
    expect(savedConversationTurnSchema.safeParse({ ...turn, evidence: [...retrieved, source] }).success).toBe(false);
    expect(savedConversationTurnSchema.safeParse({ ...turn, evidence: [{ ...source, summary: 'x'.repeat(1601) }] }).success).toBe(false);
  });
});
