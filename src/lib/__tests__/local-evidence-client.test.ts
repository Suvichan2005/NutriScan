import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistEvidenceContext } from '../assist-evidence';
import { requestLocalEvidence } from '../local-evidence-client';

const response = (overrides: Record<string, unknown> = {}) => ({
  status: 'ok', mode: 'hybrid-local-embedding', model: 'local-test-model', revision: 'test-revision',
  corpusVersion: 'food-evidence-v1', corpusSha256: 'a'.repeat(64), retrievedAt: '2026-10-23T00:00:00.000Z',
  latencyMs: 1, requestId: '00000000-0000-4000-8000-000000000001',
  results: [{
    source: {
      id: 'indian-guidance', title: 'Indian dietary guidance', publisher: 'ICMR-NIN',
      url: 'https://example.org/guidance', category: 'guideline', jurisdiction: 'India',
      publishedAt: null, effectiveAt: null, retrievedAt: '2026-10-23T00:00:00.000Z',
      summary: 'General population guidance.', limitations: 'Not a personal prescription.'
    }, semanticScore: 0.8, lexicalScore: 0.7, score: 0.77, exactIdentity: false
  }], limitations: ['Retrieval relevance is not proof of applicability.'],
  ...overrides
});

afterEach(() => vi.unstubAllGlobals());

describe('local evidence client', () => {
  it('sends only a bounded query to the same-origin index and returns attributed hits for assist assembly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response() });
    vi.stubGlobal('fetch', fetchMock);

    const query = 'Indian sodium ' + 'q'.repeat(1300);
    const hits = await requestLocalEvidence(query);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    const evidence = assistEvidenceContext({
      auditSources: [], localSearch: hits.map(({ source, score }) => ({ ...source, score })), research: []
    });

    expect(url).toBe('/api/evidence');
    expect(init.method).toBe('POST');
    expect(Object.keys(payload).sort()).toEqual(['limit', 'query']);
    expect(payload).toEqual({ query: query.slice(0, 1200), limit: 3 });
    expect(hits[0]).toMatchObject({ source: { id: 'indian-guidance' }, score: 0.77, exactIdentity: false });
    expect(evidence).toMatchObject([{ id: 'indian-guidance', publisher: 'ICMR-NIN', jurisdiction: 'India' }]);
  });

  it('does not cache failed retrievals or hide provider errors as evidence', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => response() });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestLocalEvidence('Indian guidance')).rejects.toThrow('Local evidence unavailable');
    await expect(requestLocalEvidence('Indian guidance')).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares a duplicate in-flight lookup so the local panel and assist do not load retrieval twice', async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>(resolve => { resolveResponse = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);

    const panelRequest = requestLocalEvidence('Indian guidance');
    const assistRequest = requestLocalEvidence('Indian guidance');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse!({ ok: true, json: async () => response() } as Response);
    const [panelHits, assistHits] = await Promise.all([panelRequest, assistRequest]);
    expect(panelHits).toEqual(assistHits);
    expect(panelHits).toHaveLength(1);
  });
});
