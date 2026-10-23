import { describe, expect, it } from 'vitest';
import { geminiFailureMessage, packageDisplayIdentity, parseThreadAgentTrace, savedConversationTurns, shouldShowLabelExplorer, shouldShowNutritionTable, type ThreadMessage } from '../thread-presentation';
import type { TentativeStructuredCandidate } from '../contracts';

const identityCandidate = (proposedValue: string): TentativeStructuredCandidate => ({
  candidateId: 'identity-candidate',
  kind: 'product-identity',
  field: 'product identity',
  proposedValue,
  numericValue: null,
  unit: null,
  basis: null,
  normalizedEntity: null,
  status: 'tentative',
  uncertainty: 'Model suggestion; not verified.',
  observationIds: [],
  sourceIds: [],
  supportingSpans: [],
});

describe('package display identity', () => {
  it('keeps a structured package identity ahead of model suggestions', () => {
    expect(packageDisplayIdentity(
      { name: 'Bisk Farm Cream Cracker' },
      [identityCandidate('PROTEN TOTALFAT 17.79g 11.429 1539 238g')],
    )).toEqual({ title: 'Bisk Farm Cream Cracker', source: 'package' });
  });

  it('rejects OCR-like nutrient fragments from both package and Gemini titles', () => {
    expect(packageDisplayIdentity(
      { name: 'PROTEN TOTALFAT 17.79g 11.429 1539 238g 3.55%' },
      [identityCandidate('PROTEN TOTALFAT 17.79g 11.429 1539 238g 3.55%')],
    )).toEqual({ title: 'Unidentified food package', source: 'generic' });
  });

  it('does not promote a one-word front-of-pack slogan to package identity', () => {
    expect(packageDisplayIdentity({ name: 'FREE' }, [])).toEqual({ title: 'Unidentified food package', source: 'generic' });
  });

  it('shows a plausible Gemini-only identity with its source available for a visible label', () => {
    expect(packageDisplayIdentity(
      { name: 'Unidentified package' },
      [identityCandidate('Bisk Farm Cream Cracker')],
    )).toEqual({ title: 'Bisk Farm Cream Cracker', source: 'gemini' });
  });

  it('does not promote a front-of-pack sugar slogan over a linked product identity suggestion', () => {
    expect(packageDisplayIdentity(
      { name: 'BISK FARM FREE OF SUGAR, FULL OF TASTE' },
      [identityCandidate('Bisk Farm Sugar Free Cream Cracker')],
    )).toEqual({ title: 'Bisk Farm Sugar Free Cream Cracker', source: 'gemini' });
  });
});

describe('saved conversation turns', () => {
  it('omits pending turns and strips transient UI state and tool traces before persistence', () => {
    const messages: ThreadMessage[] = [
      { question: 'What is in this?', answer: '', at: '2026-10-23T00:00:00.000Z', status: 'pending', answerOrigin: 'gemini' },
      { question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', status: 'fallback', statusDetail: 'Retry Gemini', outdated: true, answerOrigin: 'local', agentTrace: [{ name: 'search_knowledge', status: 'ok', resultCount: 2, elapsedMs: 24 }] },
    ];

    expect(savedConversationTurns(messages)).toEqual([{
      question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', answerOrigin: 'local',
    }]);
  });
});

describe('contextual nutrition UI', () => {
  it('hides mostly unknown nutrition tables for general suitability questions', () => {
    expect(shouldShowNutritionTable('Is this good to have daily for snacking?', 1)).toBe(false);
    expect(shouldShowNutritionTable('Is this good to have daily for snacking?', 3)).toBe(true);
  });

  it('keeps the full table available when the user asks to inspect nutrition', () => {
    expect(shouldShowNutritionTable('Can you show the nutrition table?', 1)).toBe(true);
    expect(shouldShowNutritionTable('How much carbohydrate is in two biscuits?', 1)).toBe(false);
  });

  it('shows ingredient context for suitability questions and explicit ingredient requests', () => {
    expect(shouldShowLabelExplorer('Is this good for daily snacking?', 'ingredient')).toBe(true);
    expect(shouldShowLabelExplorer('What ingredients and additives are listed?', 'ingredient')).toBe(true);
    expect(shouldShowLabelExplorer('What ingredients are in this?', 'ingredient')).toBe(true);
    expect(shouldShowLabelExplorer('What is the package weight?', 'ingredient')).toBe(false);
    expect(shouldShowLabelExplorer('Does this contain an allergen?', 'allergen')).toBe(true);
    expect(shouldShowLabelExplorer('Show me the nutrition table.', 'allergen')).toBe(false);
  });
});

describe('Gemini tool activity', () => {
  it('keeps only bounded, non-content trace metadata', () => {
    expect(parseThreadAgentTrace([
      { name: 'get_nutrition_guidance', status: 'ok', resultCount: 1, elapsedMs: 12 },
      { name: 'bad name', status: 'ok', resultCount: 1, elapsedMs: 12, prompt: 'private' },
      { name: 'search_knowledge', status: 'ok', resultCount: 1, elapsedMs: 12, query: 'private' },
    ])).toEqual([
      { name: 'get_nutrition_guidance', status: 'ok', resultCount: 1, elapsedMs: 12 },
      { name: 'search_knowledge', status: 'ok', resultCount: 1, elapsedMs: 12 },
    ]);
  });
});

describe('Gemini failure explanations', () => {
  it('separates Google rate or quota limits from the project spend guard', () => {
    expect(geminiFailureMessage('provider_rate_limited')).toMatch(/rate- or quota-limited/);
    expect(geminiFailureMessage('provider_rate_limited')).toMatch(/does not by itself mean the project spending limit was reached/i);
    expect(geminiFailureMessage('paid_spend_cap')).toMatch(/local Gemini spending guard/);
  });

  it('reports authentication, model and response-validation failures distinctly', () => {
    expect(geminiFailureMessage('provider_authentication_failed')).toMatch(/credentials/);
    expect(geminiFailureMessage('provider_model_unavailable')).toMatch(/model is unavailable/);
    expect(geminiFailureMessage('provider_invalid')).toMatch(/could not be read/i);
    expect(geminiFailureMessage('provider_incomplete')).toMatch(/could not finish/i);
    expect(geminiFailureMessage('provider_invalid_json')).toMatch(/not read as structured data/i);
    expect(geminiFailureMessage('provider_schema_invalid')).toMatch(/did not fit NutriScan/i);
  });
});
