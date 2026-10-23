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

/** Keep clinical guidance aligned to NutriScan's Indian-market default unless the user names another jurisdiction. */
export function isGuidanceEvidenceInScope(
  source: Pick<EvidenceSource, 'category' | 'jurisdiction'>,
  question: string,
  explicitlySharedCountry = '',
): boolean {
  if (source.category !== 'guideline') return true;
  const jurisdiction = source.jurisdiction.normalize('NFKC').toLocaleLowerCase('en-IN');
  if (/\b(?:global|international|worldwide)\b/.test(jurisdiction)) return true;
  if (/\bindia(?:n)?\b/.test(jurisdiction)) return true;

  const request = `${question} ${explicitlySharedCountry}`.normalize('NFKC').toLocaleLowerCase('en-IN');
  const namedJurisdiction = jurisdiction.split(/[;,|]/, 1)[0].trim();
  if (namedJurisdiction && request.includes(namedJurisdiction)) return true;
  if (/united states/.test(jurisdiction) && /(?:^|\W)(?:u\.?s\.?a?|american)(?:$|\W)/.test(request)) return true;
  if (/united kingdom/.test(jurisdiction) && /(?:^|\W)(?:u\.?k\.?|british)(?:$|\W)/.test(request)) return true;
  return false;
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
    return baseAnswer + ' No strong match came from the local evidence library. That does not mean relevant evidence does not exist.';
  }
  return baseAnswer + ' A related source is available in Evidence & tools: ' + first.publisher + ', ' + first.title + '. Review its jurisdiction and scope there.';
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

/** Carry source-linked audit context into the local chat reply without adding unsupported findings. */
export function buildLocalAuditConversationReply(audit: Audit, question: string): {
  answer: string;
  evidence?: ConversationEvidenceSource[];
} {
  const asksForEvidenceContext = /\b(?:compare|comparison|guidance|recommend\w*|daily|per day|whole[- ]day|reference|population|limit|according to|WHO|official|evidence|research|suitab\w*|safe|safety|health|risk|personal|me|my|allerg\w*|intoleran\w*|diabetes|blood pressure)\b/i.test(question);
  const relevantFindings = audit.findings.filter((finding) => finding.sourceIds.length > 0 && (
    (asksForEvidenceContext && finding.status === 'context') || finding.status === 'calculated'
  ));
  const referencedSourceIds = new Set(relevantFindings.flatMap((finding) => finding.sourceIds));
  const evidence = safeConversationEvidence(audit.sources.filter((source) => referencedSourceIds.has(source.id) && isGuidanceEvidenceInScope(source, question)));
  // A local fallback is a concise status, not a second research essay. Keep
  // source summaries in the evidence inspector, where their jurisdiction and
  // limitations remain visible on demand.
  const lead = audit.answer.trim().split(/\n\s*\n/, 1)[0]?.trim() ?? '';
  const sentence = lead.match(/^(.{1,700}?[.!?])(?:\s|$)/s)?.[1];
  const answer = (sentence ?? lead.slice(0, 700)).trim();

  return { answer, ...(evidence.length ? { evidence } : {}) };
}
