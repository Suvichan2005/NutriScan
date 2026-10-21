import { describe, expect, it } from 'vitest';
import { defaultProfile, savedConversationTurnSchema } from '../contracts';
import { buildAudit } from '../engine';
import { parseLabel } from '../parser';
import {
  buildLocalEvidenceFollowUp,
  buildLocalEvidenceUnavailableFollowUp,
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

  it('keeps source candidates tentative in the reply and distinguishes no-match from missing evidence', () => {
    const answer = buildLocalEvidenceFollowUp('The package alone does not answer this.', [source]);
    expect(answer).toContain(source.title);
    expect(answer).toContain(source.summary);
    expect(answer).toContain('does not establish that this source applies');

    const noMatch = buildLocalEvidenceFollowUp('The package alone does not answer this.', []);
    expect(noMatch).toContain('did not return a source candidate');
    expect(noMatch).toContain('does not mean relevant evidence does not exist');
    expect(buildLocalEvidenceUnavailableFollowUp('The package alone does not answer this.'))
      .toContain('remains a package-only response');
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
