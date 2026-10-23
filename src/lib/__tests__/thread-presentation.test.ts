import { describe, expect, it } from 'vitest';
import { packageDisplayIdentity, savedConversationTurns, type ThreadMessage } from '../thread-presentation';
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

  it('shows a plausible Gemini-only identity with its source available for a visible label', () => {
    expect(packageDisplayIdentity(
      { name: 'Unidentified package' },
      [identityCandidate('Bisk Farm Cream Cracker')],
    )).toEqual({ title: 'Bisk Farm Cream Cracker', source: 'gemini' });
  });
});

describe('saved conversation turns', () => {
  it('omits pending turns and strips transient UI state before persistence', () => {
    const messages: ThreadMessage[] = [
      { question: 'What is in this?', answer: '', at: '2026-10-23T00:00:00.000Z', status: 'pending', answerOrigin: 'gemini' },
      { question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', status: 'fallback', statusDetail: 'Retry Gemini', outdated: true, answerOrigin: 'local' },
    ];

    expect(savedConversationTurns(messages)).toEqual([{
      question: 'What is in this?', answer: 'A local reading.', at: '2026-10-23T00:01:00.000Z', answerOrigin: 'local',
    }]);
  });
});
