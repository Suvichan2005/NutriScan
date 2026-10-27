import type { AssistantUiComponent, Calculation, Observation, PackageData, SavedConversationTurn, TentativeStructuredCandidate } from './contracts';
import { calculationsFromReconstruction, normalizeReconstructedServing } from './portion';
import { calculationRespectsCorrections } from './correction';

export type ThreadMessage = SavedConversationTurn & {
  status?: 'pending' | 'fallback';
  statusDetail?: string;
  agentTrace?: ThreadAgentTrace[];
  agentDiagnostics?: ThreadAgentDiagnostics;
  diagnosticId?: string;
};

export type ThreadAgentTrace = { name: string; status: string; resultCount: number; elapsedMs: number };
export type ThreadAgentDiagnostics = {
  provider?:{model:string;tier:string;inputTokens:number|null;outputTokens:number|null;estimatedUsd:number|null;scope:'answer-only'};
  contract: string;
  answerStatus: string;
  acceptedSentences: number;
  withheldQuantitySentences: number;
  provisionalReconstructionQuantitySentences?: number;
  generationCount: number;
  toolCallCount: number;
  packageReconstructionRevision: number | null;
  retrievedSourceCount: number;
  calculationCount: number;
};

/** A failed package recheck must not erase a previously successful answer. */
export function preservePreviousAnswerAfterRejectedRecheck(
  pending: ThreadMessage,
  previous: ThreadMessage | undefined,
  fallbackDetail: string,
  diagnostics: Pick<ThreadMessage, 'agentTrace' | 'agentDiagnostics' | 'diagnosticId'> = {},
): ThreadMessage {
  if (previous?.answerOrigin === 'gemini' && previous.answer.trim()) return { ...previous, ...diagnostics };
  return {
    ...pending,
    answer: '',
    answerOrigin: 'local',
    status: 'fallback',
    statusDetail: fallbackDetail,
    uiComponents: undefined,
    calculations: undefined,
    evidence: undefined,
    ...diagnostics,
  };
}

/** Keep only bounded, non-content metadata from the server's tool trace. */
export function parseThreadAgentTrace(value: unknown): ThreadAgentTrace[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || !/^[a-z0-9_]{1,80}$/i.test(record.name)
      || typeof record.status !== 'string' || !/^[a-z_]{1,24}$/i.test(record.status)
      || typeof record.resultCount !== 'number' || !Number.isInteger(record.resultCount) || record.resultCount < 0 || record.resultCount > 1000
      || typeof record.elapsedMs !== 'number' || !Number.isFinite(record.elapsedMs) || record.elapsedMs < 0 || record.elapsedMs > 600_000) return [];
    return [{ name: record.name, status: record.status, resultCount: record.resultCount, elapsedMs: record.elapsedMs }];
  });
}

export function parseThreadAgentDiagnostics(value: unknown): ThreadAgentDiagnostics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const count = (key: string) => typeof record[key] === 'number' && Number.isInteger(record[key]) && (record[key] as number) >= 0 && (record[key] as number) <= 1000;
  if (record.contract !== 'native-tools-and-natural-text'
    || typeof record.answerStatus !== 'string' || !/^[a-z-]{1,80}$/.test(record.answerStatus)
    || !count('acceptedSentences') || !count('withheldQuantitySentences') || !count('generationCount')
    || !count('toolCallCount') || !count('retrievedSourceCount') || !count('calculationCount')
    || (record.provisionalReconstructionQuantitySentences !== undefined && !count('provisionalReconstructionQuantitySentences'))
    || !(record.packageReconstructionRevision === null || (typeof record.packageReconstructionRevision === 'number' && Number.isInteger(record.packageReconstructionRevision) && record.packageReconstructionRevision >= 1 && record.packageReconstructionRevision <= 1000))) return undefined;
  return {
    contract: record.contract,
    ...(record.provider&&typeof record.provider==='object'&&(()=>{
      const p=record.provider as Record<string,unknown>;
      return typeof p.model==='string'&&/^[a-zA-Z0-9., _-]{1,200}$/.test(p.model)&&typeof p.tier==='string'&&/^(?:free|paid)(?:, (?:free|paid))?$/.test(p.tier)&&p.scope==='answer-only'&&['inputTokens','outputTokens','estimatedUsd'].every(key=>p[key]===null||(typeof p[key]==='number'&&Number.isFinite(p[key])&&(p[key] as number)>=0));
    })()?{provider:record.provider as ThreadAgentDiagnostics['provider']}:{}),
    answerStatus: record.answerStatus,
    acceptedSentences: record.acceptedSentences as number,
    withheldQuantitySentences: record.withheldQuantitySentences as number,
    ...(count('provisionalReconstructionQuantitySentences') ? { provisionalReconstructionQuantitySentences: record.provisionalReconstructionQuantitySentences as number } : {}),
    generationCount: record.generationCount as number,
    toolCallCount: record.toolCallCount as number,
    packageReconstructionRevision: record.packageReconstructionRevision as number | null,
    retrievedSourceCount: record.retrievedSourceCount as number,
    calculationCount: record.calculationCount as number,
  };
}

export function savedConversationTurns(messages: ThreadMessage[]): SavedConversationTurn[] {
  return messages
    .filter(message => message.status !== 'pending' && message.answer.trim().length > 0)
    .map(({ status: _status, statusDetail: _statusDetail, agentTrace: _agentTrace, agentDiagnostics: _agentDiagnostics, diagnosticId: _diagnosticId, ...message }) => message)
    .slice(-30);
}

/** Keep historical answers visible without presenting their old package basis as current. */
export function supersedePackageAnswers(messages: ThreadMessage[], currentTurnAt?: string): ThreadMessage[] {
  return messages.map(message => message.at === currentTurnAt
    ? { ...message, outdated: false }
    : { ...message, outdated: true, uiComponents: undefined });
}

/** Scale a validated package calculation only within its printed mass/volume basis. */
export function scaleCalculationToPortion(calculation: Calculation, portion: number, unit: 'g' | 'ml'): number | null {
  if (!Number.isFinite(portion) || portion <= 0 || portion > 10_000 || unit !== calculation.portionUnit) return null;
  const scaled = calculation.result * portion / calculation.portion;
  return Number.isFinite(scaled) ? scaled : null;
}

/** Keep provisional provenance beside an answer when its visible calculator uses interpreted label data. */
export function hasVisibleProvisionalPackageAmounts(components: AssistantUiComponent[], calculations: Calculation[]): boolean {
  const visibleCalculationIds = new Set(components
    .filter(component => component.type === 'portion-calculator')
    .flatMap(component => component.calculationIds));
  return calculations.some(calculation => visibleCalculationIds.has(calculation.id) && Boolean(calculation.interpretationIds?.length || calculation.countedPortion));
}

/** Bind only explicitly returned operations to their trusted UI components. */
export function prepareAssistantTurnPresentation(
  components: AssistantUiComponent[],
  providerCalculations: Calculation[],
  pkg: PackageData,
): { components: AssistantUiComponent[]; calculations: Calculation[] } {
  const serving = pkg.reconstruction?.current ? normalizeReconstructedServing(pkg.reconstruction.serving) : null;
  const correctedNutrients = new Set(pkg.nutrients.filter(nutrient => nutrient.status === 'corrected').map(nutrient => nutrient.key));
  const savedServingCalculations = serving?.quantity && serving.unit
    ? calculationsFromReconstruction(pkg, serving.quantity, serving.unit)
      .filter(calculation => (!calculation.nutrient||!correctedNutrients.has(calculation.nutrient)))
    : [];
  const byBasis = new Map<string, Calculation>();
  for (const calculation of [...providerCalculations.filter(calculation => calculationRespectsCorrections(pkg, calculation)), ...savedServingCalculations]) {
    const key = [calculation.nutrient, calculation.portion, calculation.portionUnit, [...(calculation.interpretationIds ?? [])].sort().join(',')].join('|');
    if (!byBasis.has(key)) byBasis.set(key, calculation);
  }
  const calculations = [...byBasis.values()].slice(0, 20);
  return {
    calculations,
    components: components
      .filter(component => !['package-evidence', 'package-details', 'source-reference-cards'].includes(component.type))
      .slice(0, 6),
  };
}

/** Turn safe server failure codes into explanations users can act on. */
export function geminiFailureMessage(code: string, timedOut = false): string {
  if (timedOut || code === 'provider_timeout' || code === 'agent_timeout' || code === 'timeout') {
    return 'Gemini took too long to respond. Your scans are still here; try again when ready.';
  }
  switch (code) {
    case 'local_request_busy': return 'NutriScan is still finishing another request. Wait for it to finish; your package and messages are preserved.';
    case 'local_request_limit': return 'NutriScan’s local request limit paused this turn. Wait briefly before retrying; this is not a Google quota error.';
    case 'paid_spend_cap': return 'NutriScan’s local Gemini spending guard paused this request. Your scans are still here.';
    case 'paid_request_cap': return 'NutriScan’s local Gemini request limit paused this request. Your scans are still here.';
    case 'provider_rate_limited': return 'Google Gemini rate- or quota-limited this request. That does not by itself mean the project spending limit was reached.';
    case 'rate_limited': return 'NutriScan is handling another request. Wait a moment, then try again.';
    case 'provider_authentication_failed': return 'Google rejected the configured Gemini credentials. Check the server-side key for the selected project.';
    case 'provider_access_denied': return 'Google denied this request. Check project API access, billing status and model availability.';
    case 'provider_model_unavailable': return 'The selected Gemini model is unavailable to this project right now.';
    case 'provider_request_rejected': return 'Google rejected the Gemini request format. Your scans are still here; retry after updating the app.';
    case 'provider_invalid_json': return 'Gemini returned text that NutriScan could not read as structured data. Your scan is still here; retry when ready.';
    case 'provider_schema_invalid': return 'Gemini could not finish an answer NutriScan can use. Your package and earlier messages are still here; try again.';
    case 'provider_invalid': return 'Gemini’s response could not be read. Your scan is still here; retry when ready.';
    case 'provider_incomplete': return 'Gemini could not finish this response. Your scan is still here; retry when ready.';
    case 'provider_unavailable': return 'Google Gemini is temporarily unavailable. Your scans are still here; try again later.';
    case 'free_models_exhausted': return 'The configured free Gemini models did not finish this request. Your package and conversation are still available in this scan; try again later.';
    case 'paid_provider_unauthorized':
    case 'paid_price_missing':
    case 'provider_disabled':
    case 'provider_not_configured': return 'Gemini is not enabled for this local session. Your scans are still here.';
    case 'request_failed': return 'NutriScan could not reach its local Gemini service. Your scans are still here.';
    default: return 'Gemini could not complete this answer. Your scans are still here; retry or use the local reading.';
  }
}

const nutrientWords = /\b(?:energy|kcal|kilojoules?|carbohydrates?|carbs?|protein|proten|fat|sodium|salt|sugars?|fibre|fiber|serving|nutrition|nutritional|quantity|per\s*100)\b/gi;
const numericMeasurement = /\b\d+(?:[.,]\d+)?\s*(?:g|mg|kcal|kj|ml|%|percent)\b/i;
const minIdentityOcrConfidence = 80;

function cleanIdentity(value: string | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 90 || /^(?:unidentified(?: food)? package|your package|unknown)$/i.test(cleaned)) return null;
  // Short front-of-pack slogans and benefit fragments are often mistaken for
  // a product name when OCR reads the package before the brand or variant.
  if (/^(?:free|sugar|sugar[- ]free|no added sugar|zero|natural|fresh|healthy|full of taste)$/i.test(cleaned)) return null;
  // A common front-of-pack slogan can be the first OCR line; don't present it
  // as the product name when a separately linked identity suggestion exists.
  if (/\bfree of sugar\b.{0,40}\bfull of taste\b/i.test(cleaned)) return null;

  const numbers = cleaned.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const nutrientMatches = cleaned.match(nutrientWords) ?? [];
  if (numbers.length > 1 || numericMeasurement.test(cleaned) || nutrientMatches.length > 1) return null;
  if (/^(?:nutrition|nutritional information|ingredients|serving size|per\s*100\b)/i.test(cleaned)) return null;
  if (cleaned.split(' ').length > 10) return null;

  return cleaned;
}

export type DisplayIdentity = { title: string; source: 'package' | 'gemini' | 'generic' };

export function packageDisplayIdentity(
  pkg: { name: string; brand?: string; userDescription?: string; observations?: (Pick<Observation,'origin'|'field'|'text'> & Partial<Pick<Observation,'imageId'|'confidence'>>)[]; reconstruction?: { current?: boolean; identity: { name: string | null; brand: string | null; variant: string | null; status: string } } | null },
  candidates: TentativeStructuredCandidate[],
): DisplayIdentity {
  // Explicit application-recorded corrections outrank interpretations. Keep
  // compatibility with older corrections that stored the name in their note.
  const correctedName = pkg.observations?.some(observation => observation.origin === 'user'
    && ((observation.field === 'productName' && observation.text === pkg.name)
      || observation.text.endsWith('; product name supplied by user: ' + pkg.name)));
  const nameAlsoClassifiedAsAnotherField = !correctedName && pkg.observations?.some(observation =>
    observation.text.trim() === pkg.name && observation.field !== 'name' && observation.field !== 'productName');
  const brandAlsoClassifiedAsAnotherField = Boolean(pkg.brand) && pkg.observations?.some(observation =>
    observation.text.trim() === pkg.brand && observation.field !== 'brand');
  if (correctedName && cleanIdentity(pkg.name)) return { title: cleanIdentity(pkg.name)!, source: 'package' };

  const interpretation = pkg.reconstruction?.identity;
  if (interpretation && pkg.reconstruction?.current !== false && ['clear','provisional'].includes(interpretation.status)) {
    const reconstructed = [interpretation.brand, interpretation.name, interpretation.variant]
      .map(value => value ? cleanIdentity(value) : null)
      .filter((value): value is string => Boolean(value));
    if (reconstructed.length) return { title: [...new Set(reconstructed)].join(' '), source: 'gemini' };
  }

  // Parsed name and brand fields can contain copied label fragments. Only an
  // explicit user detail/correction or a high-confidence photo-linked identity
  // is strong enough to label the package when reconstruction has no identity.
  const explicitDescription = cleanIdentity(pkg.userDescription);
  if (explicitDescription) return { title: explicitDescription, source: 'package' };
  const photoIdentity = pkg.observations?.some(observation =>
    !nameAlsoClassifiedAsAnotherField
    && observation.origin === 'ocr'
    && observation.field === 'name'
    && observation.text.trim() === pkg.name
    && Boolean(observation.imageId)
    && typeof observation.confidence === 'number'
    && observation.confidence >= minIdentityOcrConfidence,
  );
  const photoBrand = pkg.observations?.some(observation =>
    !brandAlsoClassifiedAsAnotherField
    && observation.origin === 'ocr'
    && observation.field === 'brand'
    && observation.text.trim() === pkg.brand
    && Boolean(observation.imageId)
    && typeof observation.confidence === 'number'
    && observation.confidence >= minIdentityOcrConfidence,
  );
  const supported = photoIdentity ? cleanIdentity(pkg.name) : photoBrand ? cleanIdentity(pkg.brand) : null;
  if (supported) return { title: supported, source: 'package' };

  const suggestion = candidates.find(candidate => candidate.kind === 'product-identity' && cleanIdentity(candidate.proposedValue));
  if (suggestion) return { title: cleanIdentity(suggestion.proposedValue)!, source: 'gemini' };

  return { title: 'Unidentified food package', source: 'generic' };
}

/** Keep a prior tentative package identity across a recheck that returns no replacement identity. */
export function mergeRecheckedPackageCandidates(
  previous: TentativeStructuredCandidate[],
  incoming: TentativeStructuredCandidate[],
): TentativeStructuredCandidate[] {
  if (incoming.some(candidate => candidate.kind === 'product-identity')) return incoming.slice(0, 20);
  const incomingIds = new Set(incoming.map(candidate => candidate.candidateId));
  const priorIdentity = previous.filter(candidate => candidate.kind === 'product-identity' && !incomingIds.has(candidate.candidateId));
  return [...priorIdentity, ...incoming].slice(0, 20);
}
