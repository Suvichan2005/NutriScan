import { parseLocalEvidenceResponse, type LocalEvidenceCandidate } from './followup-evidence';

const requests = new Map<string, Promise<LocalEvidenceCandidate[]>>();

/** Query the same-origin curated index without attaching photos or profile context. */
export function requestLocalEvidence(query: string, explicitlySharedCountry = ''): Promise<LocalEvidenceCandidate[]> {
  const boundedQuery = query.trim().slice(0, 1200);
  if (!boundedQuery) return Promise.resolve([]);
  const boundedCountry = explicitlySharedCountry.trim().slice(0, 80);
  const cacheKey = `${boundedQuery}\u0000${boundedCountry}`;

  const existing = requests.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    const response = await fetch('/api/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: boundedQuery, limit: 3 }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('Local evidence unavailable.');
    return parseLocalEvidenceResponse(await response.json(), boundedQuery, boundedCountry).hits;
  })();

  requests.set(cacheKey, request);
  void request.finally(() => {
    if (requests.get(cacheKey) === request) requests.delete(cacheKey);
  }).catch(() => undefined);
  return request;
}
