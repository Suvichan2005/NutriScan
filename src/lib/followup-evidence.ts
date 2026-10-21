import {
  conversationEvidenceSourceSchema,
  localEvidenceResponseSchema,
  type Audit,
  type ConversationEvidenceSource,
  type EvidenceSource
} from './contracts';

export type LocalEvidenceCandidate = { source: ConversationEvidenceSource; score: number };

/** Only unsupported package-only answers use the curated local evidence index. */
export function shouldSearchLocalEvidence(audit: Audit): boolean {
  return audit.trace.some((item) =>
    item.tool === 'local_rule_answer' && /unsupported local question/i.test(item.reason)
  );
}

export function isSafeEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::') return false;
    if (/^(?:0|10|127|169\.254|192\.168)\./.test(host)) return false;
    const ipv4 = host.match(/^172\.(\d{1,3})\./);
    if (ipv4 && Number(ipv4[1]) >= 16 && Number(ipv4[1]) <= 31) return false;
    if (/^(?:fc|fd|fe[89ab])/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Validate the shared local retrieval response before it enters chat or saved state. */
export function parseLocalEvidenceResponse(value: unknown): {
  status: 'ok' | 'no_match';
  hits: LocalEvidenceCandidate[];
  message?: string;
} {
  const parsed = localEvidenceResponseSchema.parse(value);
  const seen = new Set<string>();
  const hits = parsed.results.flatMap((hit) => {
    const source = hit.source;
    if (!isSafeEvidenceUrl(source.url) || seen.has(source.id)) return [];
    seen.add(source.id);
    return [{ source, score: hit.score }];
  }).slice(0, 3);
  return { status: parsed.status, hits, ...(parsed.message ? { message: parsed.message } : {}) };
}

export function buildLocalEvidenceFollowUp(
  baseAnswer: string,
  sources: ConversationEvidenceSource[],
): string {
  const first = sources[0];
  if (!first) {
    return baseAnswer + ' The curated local library did not return a source candidate above its development relevance floor. That does not mean relevant evidence does not exist; refine the question or use a current source search when needed.';
  }
  return baseAnswer + ' The local evidence library surfaced ' + first.publisher + ': ' + first.title +
    '. Its curated summary says: ' + first.summary +
    ' Review the linked source and its scope below. A retrieval match is a discovery cue; it does not establish that this source applies to this package or your personal situation.';
}

export function buildLocalEvidenceUnavailableFollowUp(baseAnswer: string): string {
  return baseAnswer + ' The local evidence library was unavailable, so this remains a package-only response.';
}

/** Keep only bounded, safe citations when restoring or preparing source context. */
export function safeConversationEvidence(sources: readonly EvidenceSource[] | undefined): ConversationEvidenceSource[] {
  if (!sources) return [];
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (!isSafeEvidenceUrl(source.url) || seen.has(source.id)) return [];
    const parsed = conversationEvidenceSourceSchema.safeParse(source);
    if (!parsed.success || seen.has(parsed.data.id)) return [];
    seen.add(parsed.data.id);
    return [parsed.data];
  }).slice(0, 3);
}
