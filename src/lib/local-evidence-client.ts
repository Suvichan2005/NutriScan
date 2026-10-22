import { parseLocalEvidenceResponse, type LocalEvidenceCandidate } from './followup-evidence';

const requests = new Map<string, Promise<LocalEvidenceCandidate[]>>();

/** Query the same-origin curated index without attaching photos or profile context. */
export function requestLocalEvidence(query: string): Promise<LocalEvidenceCandidate[]> {
  const boundedQuery = query.trim().slice(0, 1200);
  if (!boundedQuery) return Promise.resolve([]);

  const existing = requests.get(boundedQuery);
  if (existing) return existing;

  const request = (async () => {
    const response = await fetch('/api/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: boundedQuery, limit: 3 }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('Local evidence unavailable.');
    return parseLocalEvidenceResponse(await response.json()).hits;
  })();

  requests.set(boundedQuery, request);
  void request.finally(() => {
    if (requests.get(boundedQuery) === request) requests.delete(boundedQuery);
  }).catch(() => undefined);
  return request;
}
