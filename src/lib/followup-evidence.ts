import {
  conversationEvidenceSourceSchema,
  localEvidenceResponseSchema,
  type Audit,
  type ConversationEvidenceSource,
  type EvidenceSource,
  type PackageData,
} from './contracts';

export type LocalEvidenceCandidate = { source: ConversationEvidenceSource; score: number; exactIdentity: boolean };

const genericEvidenceTerms = new Set([
  'a','about','according','after','and','any','are','as','at','be','because','before','between','can','could','describe','describes','does','effect','evidence','food','foods','for','from','good','guidance','health','healthy','how','in','information','into','is','it','label','labels','may','more','nutrition','nutritional','of','on','or','package','packages','product','products','research','should','some','study','studies','that','the','their','there','these','this','those','to','what','when','where','which','with','would'
]);

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
  source: Pick<EvidenceSource, 'title' | 'publisher' | 'summary'>,
  query: string,
  exactIdentity = false,
): boolean {
  const queryTokens = [...new Set(evidenceTokens(query).filter(token => token.length >= 3 && token.length <= 48 && !genericEvidenceTerms.has(token)))];
  const sourceTokenList = evidenceTokens(`${source.title} ${source.publisher} ${source.summary}`);
  const exclusionMarkers = new Set(['exclude','excludes','excluding','excluded','except']);
  for (let index = 0; index < sourceTokenList.length; index++) {
    if (!queryTokens.includes(sourceTokenList[index])) continue;
    const preceding = sourceTokenList.slice(Math.max(0, index - 6), index);
    if (preceding.some(token => exclusionMarkers.has(token))) return false;
  }
  if (exactIdentity) return true;
  if (!queryTokens.length) return false;

  const sourceTokens = new Set(sourceTokenList);
  const namedEntityTokens = queryTokens.filter(token => token.length >= 10);
  // A specific substance, nutrient, or condition should be present in the source
  // itself. A broad source about food or health cannot stand in for that evidence.
  if (namedEntityTokens.length) return namedEntityTokens.some(token => sourceTokens.has(token));
  return queryTokens.some(token => sourceTokens.has(token));
}

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

/** Give a failed cloud turn a concise, traceable package snapshot without presenting it as an AI assessment. */
export function buildLocalPackageFallbackReply(audit: Audit, question: string, pkg: PackageData): {
  answer: string;
  evidence?: ConversationEvidenceSource[];
} {
  const compact = (value: string | null | undefined, maxLength: number) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  const linked = (value: { observationIds: string[]; imageRegions: { imageId: string }[] }) =>
    value.observationIds.length > 0 || value.imageRegions.length > 0;
  const current = pkg.reconstruction?.current ? pkg.reconstruction : undefined;
  const facts: string[] = [];
  const identity = current?.identity;
  const asksIdentity = /\b(?:brand|product name|what product|identify|identity)\b/i.test(question);
  if (asksIdentity && identity && ['clear', 'provisional'].includes(identity.status) && linked(identity.evidence)) {
    const name = [identity.brand, identity.name, identity.variant].map(part => compact(part, 100)).filter(Boolean).join(' ').slice(0, 240);
    if (name) facts.push(`The saved label reading appears to identify ${name}.`);
  }
  const serving = current?.serving;
  const asksServing = /\b(?:serving|portion|how much|how many|biscuits?|pieces?)\b/i.test(question);
  const foodChoice = /\b(?:good|healthy|suitable|daily|every\s+day|regular(?:ly)?|snack(?:ing)?|fit\s+my\s+goals?|should\s+i|can\s+i\s+(?:eat|have))\b/i.test(question);
  if ((asksServing || foodChoice) && serving && ['clear', 'provisional'].includes(serving.status) && linked(serving.evidence)) {
    const pieces = serving.pieceCount ? `${serving.pieceCount} ${serving.pieceDescription ?? 'pieces'}` : '';
    const mass = serving.quantity && serving.unit ? `about ${serving.quantity} ${serving.unit}` : '';
    const text = compact(serving.printedText, 180) || (pieces && mass ? `${pieces} (${mass})` : pieces || mass);
    if (text) facts.push(`It appears to define a serving as ${text}.`);
  }
  const asksIngredients = /\b(?:ingredient|made of|contains what)\b/i.test(question);
  const ingredients = current?.ingredients
    .filter(item => ['clear', 'provisional'].includes(item.status) && linked(item.evidence))
    .sort((a, b) => a.position - b.position)
    .slice(0, asksIngredients || foodChoice ? 2 : 0) ?? [];
  if (ingredients.length) {
    const text = ingredients.map(item => `${compact(item.name, 110)}${item.printedPercentage === null ? '' : ` (printed ${item.printedPercentage}%)`}`).join(', ');
    facts.push(`The reading lists ${text}${ingredients[0].position === 0 ? ' among the first ingredients' : ' in the ingredient list'}.`);
  } else if ((asksIngredients || foodChoice) && pkg.ingredients.length) {
    facts.push(`The recorded ingredient list begins with ${pkg.ingredients.slice(0, 2).map(item => compact(item, 120)).join(', ')}.`);
  }
  const asksClaim = /\b(?:claim|sugar[- ]free|no added sugar|low[- ]fat|high[- ]protein)\b/i.test(question);
  const claim = (asksClaim || foodChoice) ? current?.statements.find(item => item.kind === 'claim' && ['clear', 'provisional'].includes(item.status) && linked(item.evidence)) : undefined;
  if (claim) facts.push(`The package reading includes the claim “${compact(claim.text, 140)}”.`);
  else if ((asksClaim || foodChoice) && pkg.claims.length) facts.push(`The recorded package claim is “${compact(pkg.claims[0], 140)}”.`);

  const requested = question.match(/\b(protein|carbohydrates?|carbs?|sugars?|sodium|salt|fibre|fiber|fat|energy|calories?)\b/i)?.[1]?.toLowerCase();
  const nutrientAliases: Record<string, string> = { carbs: 'carbohydrate', carbohydrate: 'carbohydrate', carbohydrates: 'carbohydrate', sugar: 'sugars', sugars: 'sugars', calories: 'energy', calorie: 'energy', fibre: 'fiber' };
  const requestedKey = requested ? nutrientAliases[requested] ?? requested : undefined;
  const defaultOrder = ['carbohydrate', 'sugars', 'sodium', 'salt', 'protein', 'fat', 'fiber', 'energy'];
  const uniqueOrder = requestedKey ? [requestedKey, ...defaultOrder.filter(key => key !== requestedKey)] : defaultOrder;
  const calculations = [...audit.calculations].sort((a, b) => uniqueOrder.indexOf(a.nutrient??'') - uniqueOrder.indexOf(b.nutrient??''))
    .filter(calculation => uniqueOrder.includes(calculation.nutrient??'')).slice(0, foodChoice ? 2 : 1);
  if (calculations.length) {
    const details = calculations.map(calculation => {
      const nutrient = (calculation.nutrientLabel??calculation.nutrient??'nutrient').replace(/([A-Z])/g, ' $1').toLocaleLowerCase('en-IN');
      const result = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(calculation.result);
      const input = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(calculation.input);
      const basis = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(calculation.basisAmount);
      const portion = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(calculation.portion);
      const qualifier = calculation.interpretationIds?.length ? 'provisional image reading' : 'saved label reading';
      return `${result} ${calculation.unit} ${nutrient} for ${portion} ${calculation.portionUnit}, scaled from ${input} ${calculation.inputUnit} per ${basis} ${calculation.portionUnit} (${qualifier})`;
    });
    facts.push(`The recorded calculation gives ${details.join('; ')}.`);
  }

  if (foodChoice && !calculations.some(calculation => calculation.nutrient === 'carbohydrate')) {
    facts.push('A usable carbohydrate amount for the selected portion is not present in this saved reading.');
  }
  const answer = facts.length
    ? `${facts.join(' ')} ${foodChoice ? 'This on-device summary describes unverified label readings; it does not determine individual suitability.' : 'These on-device package readings remain unverified.'}`.slice(0, 1500)
    : 'Gemini could not complete this answer, and the saved package record has no linked structured detail suitable for a short local summary. Open Package details to inspect the retained readings, or retry the analysis.';
  const sourceIds = new Set(audit.findings.filter(finding => finding.status === 'context' && finding.sourceIds.length > 0).flatMap(finding => finding.sourceIds));
  const evidence = safeConversationEvidence(audit.sources.filter(source => sourceIds.has(source.id) && isGuidanceEvidenceInScope(source, question)));
  return { answer, ...(evidence.length ? { evidence } : {}) };
}
