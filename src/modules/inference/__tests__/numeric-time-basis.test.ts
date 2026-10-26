import { expect, it } from 'vitest';
import { validateNaturalAnswerText } from '../core';
import { parseLabel } from '../../../lib/parser';
import type { EvidenceSource } from '../../../lib/contracts';

const source: EvidenceSource = { id: 'synthetic-rates', title: 'Synthetic temporal-unit fixture', publisher: 'Test', url: 'https://example.test/rates', category: 'method', jurisdiction: 'Synthetic', publishedAt: null, effectiveAt: null, retrievedAt: '2026-10-26', summary: 'The reference is at least 25 g per day. A separate reference is at most 40 mg per week.', limitations: 'Numerical test fixture, not dietary or medical guidance.' };
const context = { package: parseLabel('Synthetic fixture; composition unknown.'), evidence: [source] };

it('recognizes a rate adverb within the same bounded quantity phrase, including after the measured item', () => {
  for (const answer of ['The reference is at least 25 g of fibre daily.', 'The weekly reference is at most 40 mg.', 'The reference is at most 40 mg of the measured substance weekly.']) {
    expect(validateNaturalAnswerText(answer, context).answer).toBe(answer);
  }
});

it('keeps time units, dimensions, comparators and unrelated measured amounts distinct', () => {
  for (const answer of ['The reference is at least 25 g of fibre weekly.', 'The reference is at least 25 mg daily.', 'The reference is at most 25 g daily.', 'The reference is at most 40 mg daily.', 'The reference is at least 25 g.']) {
    expect(validateNaturalAnswerText(answer, context).withheldUnsupportedQuantitySentenceCount).toBe(1);
  }
  expect(validateNaturalAnswerText('This package contains 25 g fibre daily.', { ...context, evidence: [] }).withheldUnsupportedQuantitySentenceCount).toBe(1);
});
