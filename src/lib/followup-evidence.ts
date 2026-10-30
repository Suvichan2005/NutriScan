import {
  conversationEvidenceSourceSchema,
  localEvidenceResponseSchema,
  type ConversationEvidenceSource,
  type EvidenceSource,
} from './contracts';

export type LocalEvidenceCandidate = { source: ConversationEvidenceSource; score: number; exactIdentity: boolean };

const genericEvidenceTerms = new Set([
  'a','about','according','after','and','any','are','as','at','be','because','before','between','can','could','describe','describes','does','effect','evidence','food','foods','for','from','good','guidance','health','healthy','how','in','information','into','is','it','label','labels','may','more','nutrition','nutritional','of','on','or','package','packages','product','products','research','should','some','study','studies','that','the','their','there','these','this','those','to','what','when','where','which','with','would'
]);
// Broad context words can accompany a named ingredient without making a
// generic source about that broad topic applicable to the named ingredient.
const broadContextTerms = new Set(['dietary','effect','effects','fibre','fiber','intake','amount']);

function evidenceTokens(value: string): string[] {
  return (value.normalize('NFKC').toLocaleLowerCase('en-IN').match(/[\p{L}\p{N}]+/gu) ?? [])
    .flatMap(token => {
      const forms = [token];
      if (token.endsWith('ies') && token.length > 4) forms.push(`${token.slice(0, -3)}y`);
      else if (token.endsWith('ing') && token.length > 6) forms.push(token.slice(0, -3));
      else if (token.endsWith('ic') && token.length > 5) forms.push(token.slice(0, -2));
      else if (token.endsWith('s') && token.length > 4) forms.push(token.slice(0, -1));
      if (token === 'diabetes' || token === 'diabetic') forms.push('diabet');
      return forms;
    });
}

/** Reject obvious semantic near-matches before local sources enter an answer. Exact entity matches remain eligible. */
export function isLocalEvidenceTopicallyRelevant(
  source: Pick<EvidenceSource, 'title' | 'publisher' | 'summary'> & Partial<Pick<EvidenceSource, 'category'>>,
  query: string,
  exactIdentity = false,
): boolean {
  const asksForNutrientValue = /\b(?:calcium|iron|potassium|magnesium|zinc|cholesterol|protein|carbohydrates?|carbs?|sugars?|sodium|salt|fibre|fiber|fat|energy|calories?)\b/i.test(query)
    && /\b(?:listed|amount|how much|per\s*(?:100|serving|portion)|nutrition|nutrient|content)\b/i.test(query);
  const explicitlyAsksAboutAdditives = /\b(?:additive|INS\s*\d|E\d{3,4}|EDTA|preservative|stabili[sz]er|sweetener|colour|color)\b/i.test(query);
  const isAdditiveIdentity = source.category === 'registry' && /\badditive identity\b/i.test(source.title);
  if (isAdditiveIdentity && asksForNutrientValue && !explicitlyAsksAboutAdditives) return false;

  const queryTokens = [...new Set(evidenceTokens(query).filter(token => token.length >= 3 && token.length <= 48 && !genericEvidenceTerms.has(token)))];
  const sourceTitleTokens = new Set(evidenceTokens(source.title));
  const sourceTokenList = evidenceTokens(`${source.title} ${source.publisher} ${source.summary}`);
  const exclusionMarkers = new Set(['exclude','excludes','excluding','excluded','except']);
  for (let index = 0; index < sourceTokenList.length; index++) {
    if (!queryTokens.includes(sourceTokenList[index])) continue;
    const preceding = sourceTokenList.slice(Math.max(0, index - 6), index);
    if (preceding.some(token => exclusionMarkers.has(token)) && !sourceTitleTokens.has(sourceTokenList[index])) return false;
  }
  if (exactIdentity) return true;
  if (!queryTokens.length) return false;

  const sourceTokens = new Set(sourceTokenList);
  const namedEntityTokens = queryTokens.filter(token => token.length >= 10);
  const matchedNamedEntityTokens = namedEntityTokens.filter(token => sourceTokens.has(token));
  // A specific substance, nutrient, or condition should be present in the source
  // itself when possible. Multi-part queries also contain conditions and other
  // context that every useful source will not repeat; retain a direct match on
  // another substantive topic term (for example sodium in a hypertension query).
  if (matchedNamedEntityTokens.length && (namedEntityTokens.length < 2 || matchedNamedEntityTokens.length >= 2)) return true;
  const substantiveTopicTokens = queryTokens.filter(token => token.length >= 4 && !broadContextTerms.has(token) && !namedEntityTokens.includes(token));
  const matchedTopicTokens = substantiveTopicTokens.filter(token => sourceTokens.has(token));
  // A source selected for one explicit topic can remain useful when the user
  // adds a second, personal-context term that the source does not discuss
  // (for example, sodium guidance in a question that also mentions diabetes).
  // The topic match still has to be direct; personal context alone is never
  // enough to attach a source.
  if (namedEntityTokens.length) return matchedTopicTokens.length >= 1;
  return queryTokens.some(token => sourceTokens.has(token));
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
export function parseLocalEvidenceResponse(value: unknown, query?: string, explicitlySharedCountry = ''): {
  status: 'ok' | 'no_match';
  hits: LocalEvidenceCandidate[];
  message?: string;
} {
  const parsed = localEvidenceResponseSchema.parse(value);
  const seen = new Set<string>();
  const hits = parsed.results.flatMap((hit) => {
    const source = hit.source;
    if (!isSafeEvidenceUrl(source.url) || seen.has(source.id)) return [];
    if (query && (!isLocalEvidenceTopicallyRelevant(source, query, hit.exactIdentity) || !isGuidanceEvidenceInScope(source, query, explicitlySharedCountry))) return [];
    seen.add(source.id);
    return [{ source, score: hit.score, exactIdentity: hit.exactIdentity }];
  }).slice(0, 3);
  const filteredToNoMatch = !!query && parsed.results.length > 0 && hits.length === 0;
  return {
    status: hits.length ? parsed.status : filteredToNoMatch ? 'no_match' : parsed.status,
    hits,
    ...(filteredToNoMatch ? { message: 'No returned source passed the topical relevance and jurisdiction checks. This does not establish that relevant evidence does not exist.' } : parsed.message ? { message: parsed.message } : {}),
  };
}

/** Keep bounded, safe source records when restoring or preparing answer/source context. */
export function safeConversationEvidence(sources: readonly EvidenceSource[] | undefined, limit = 3): ConversationEvidenceSource[] {
  if (!sources) return [];
  const boundedLimit=Math.min(8,Math.max(0,Math.trunc(limit)));
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (!isSafeEvidenceUrl(source.url) || seen.has(source.id)) return [];
    const parsed = conversationEvidenceSourceSchema.safeParse(source);
    if (!parsed.success || seen.has(parsed.data.id)) return [];
    seen.add(parsed.data.id);
    return [parsed.data];
  }).slice(0, boundedLimit);
}
