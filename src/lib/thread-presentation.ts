import type { SavedConversationTurn, TentativeStructuredCandidate } from './contracts';

export type ThreadMessage = SavedConversationTurn & {
  status?: 'pending' | 'fallback';
  statusDetail?: string;
  outdated?: boolean;
  agentTrace?: ThreadAgentTrace[];
  agentDiagnostics?: ThreadAgentDiagnostics;
  diagnosticId?: string;
};

export type ThreadAgentTrace = { name: string; status: string; resultCount: number; elapsedMs: number };
export type ThreadAgentDiagnostics = {
  schemaMode: string;
  modelOutputStatus: string;
  answerStatus: string;
  acceptedClaims: number;
  rejectedClaims: number;
  acceptedAnswerParts: number;
  rejectedAnswerParts: number;
  rejectedReasons: Record<string, number>;
};

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
  const count = (key: string) => typeof record[key] === 'number' && Number.isInteger(record[key]) && (record[key] as number) >= 0 && (record[key] as number) <= 100;
  if (typeof record.schemaMode !== 'string' || !/^[a-z-]{1,80}$/.test(record.schemaMode)
    || typeof record.modelOutputStatus !== 'string' || !/^[a-z-]{1,80}$/.test(record.modelOutputStatus)
    || typeof record.answerStatus !== 'string' || !/^[a-z-]{1,80}$/.test(record.answerStatus)
    || !count('acceptedClaims') || !count('rejectedClaims') || !count('acceptedAnswerParts') || !count('rejectedAnswerParts')
    || !record.rejectedReasons || typeof record.rejectedReasons !== 'object' || Array.isArray(record.rejectedReasons)) return undefined;
  const rejectedReasons = Object.fromEntries(Object.entries(record.rejectedReasons as Record<string, unknown>).slice(0, 12).flatMap(([reason, total]) =>
    /^[a-z-]{1,80}$/.test(reason) && typeof total === 'number' && Number.isInteger(total) && total > 0 && total <= 100 ? [[reason, total]] : [],
  ));
  return {
    schemaMode: record.schemaMode,
    modelOutputStatus: record.modelOutputStatus,
    answerStatus: record.answerStatus,
    acceptedClaims: record.acceptedClaims as number,
    rejectedClaims: record.rejectedClaims as number,
    acceptedAnswerParts: record.acceptedAnswerParts as number,
    rejectedAnswerParts: record.rejectedAnswerParts as number,
    rejectedReasons,
  };
}

export function savedConversationTurns(messages: ThreadMessage[]): SavedConversationTurn[] {
  return messages
    .filter(message => message.status !== 'pending' && message.answer.trim().length > 0)
    .map(({ status: _status, statusDetail: _statusDetail, outdated: _outdated, agentTrace: _agentTrace, agentDiagnostics: _agentDiagnostics, diagnosticId: _diagnosticId, ...message }) => message)
    .slice(-30);
}

/** Don't mount an empty nutrition table for an unrelated conversational question. */
export function shouldShowNutritionTable(question: string, usableReadingCount: number): boolean {
  return /\b(?:nutrition|nutrients?|macros?|full label table|show (?:me )?(?:the )?table|per\s*100\b|list (?:the )?(?:values|amounts))\b/i.test(question)
    || usableReadingCount >= 3;
}

/** Keep label explorers out of general answers; raw OCR review belongs in the inspector. */
export function shouldShowLabelExplorer(question: string, kind: 'ingredient' | 'allergen'): boolean {
  return kind === 'ingredient'
    ? /\b(?:ingredients?|additives?|preservatives?|what(?:'s| is) (?:in|inside)|made from)\b/i.test(question)
      || /\b(?:suitab\w*|daily|everyday|snack\w*|good for|better choice|food choice)\b/i.test(question)
    : /\b(?:allerg(?:y|ies|en)|cross[- ]contact|may contain|allergen statement)\b/i.test(question);
}

/** Turn safe server failure codes into explanations users can act on. */
export function geminiFailureMessage(code: string, timedOut = false): string {
  if (timedOut || code === 'provider_timeout' || code === 'agent_timeout' || code === 'timeout') {
    return 'Gemini took too long to respond. Your scans are still here; try again when ready.';
  }
  switch (code) {
    case 'paid_spend_cap': return 'NutriScan’s local Gemini spending guard paused this request. Your scans are still here.';
    case 'paid_request_cap': return 'NutriScan’s local Gemini request limit paused this request. Your scans are still here.';
    case 'provider_rate_limited': return 'Google Gemini rate- or quota-limited this request. That does not by itself mean the project spending limit was reached.';
    case 'rate_limited': return 'NutriScan is handling another request. Wait a moment, then try again.';
    case 'provider_authentication_failed': return 'Google rejected the configured Gemini credentials. Check the server-side key for the selected project.';
    case 'provider_access_denied': return 'Google denied this request. Check project API access, billing status and model availability.';
    case 'provider_model_unavailable': return 'The selected Gemini model is unavailable to this project right now.';
    case 'provider_request_rejected': return 'Google rejected the Gemini request format. Your scans are still here; retry after updating the app.';
    case 'provider_invalid_json': return 'Gemini returned text that NutriScan could not read as structured data. Your scan is still here; retry when ready.';
    case 'provider_schema_invalid': return 'Gemini returned structured data that did not fit NutriScan’s response format. Your scan is still here; retry when ready.';
    case 'provider_invalid': return 'Gemini’s response could not be read. Your scan is still here; retry when ready.';
    case 'provider_incomplete': return 'Gemini could not finish this response. Your scan is still here; retry when ready.';
    case 'provider_unavailable': return 'Google Gemini is temporarily unavailable. Your scans are still here; try again later.';
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
  pkg: { name: string; brand?: string },
  candidates: TentativeStructuredCandidate[],
): DisplayIdentity {
  const supported = cleanIdentity(pkg.name) ?? cleanIdentity(pkg.brand);
  if (supported) return { title: supported, source: 'package' };

  const suggestion = candidates.find(candidate => candidate.kind === 'product-identity' && cleanIdentity(candidate.proposedValue));
  if (suggestion) return { title: cleanIdentity(suggestion.proposedValue)!, source: 'gemini' };

  return { title: 'Unidentified food package', source: 'generic' };
}
