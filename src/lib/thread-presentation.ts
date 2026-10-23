import type { SavedConversationTurn, TentativeStructuredCandidate } from './contracts';

export type ThreadMessage = SavedConversationTurn & {
  status?: 'pending' | 'fallback';
  statusDetail?: string;
  outdated?: boolean;
};

export function savedConversationTurns(messages: ThreadMessage[]): SavedConversationTurn[] {
  return messages
    .filter(message => message.status !== 'pending' && message.answer.trim().length > 0)
    .map(({ status: _status, statusDetail: _statusDetail, outdated: _outdated, ...message }) => message)
    .slice(-30);
}

const nutrientWords = /\b(?:energy|kcal|kilojoules?|carbohydrates?|carbs?|protein|proten|fat|sodium|salt|sugars?|fibre|fiber|serving|nutrition|nutritional|quantity|per\s*100)\b/gi;
const numericMeasurement = /\b\d+(?:[.,]\d+)?\s*(?:g|mg|kcal|kj|ml|%|percent)\b/i;

function cleanIdentity(value: string | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 90 || /^(?:unidentified(?: food)? package|your package|unknown)$/i.test(cleaned)) return null;

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
