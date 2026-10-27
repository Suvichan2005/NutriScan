import { describe, expect, it } from 'vitest';
import { splitProseSentences } from '../prose-sentences';

describe('coherent prose validation boundaries', () => {
  it('keeps parenthetical abbreviations and bold labels attached to their statements', () => {
    expect(splitProseSentences('**Sugar vs. starch:** A serving (approx. 12 g) is printed. Sodium is unknown.')).toEqual([
      '**Sugar vs. starch:** A serving (approx. 12 g) is printed.', 'Sodium is unknown.',
    ]);
  });
  it('preserves independent sentences, decimals and an unresolved bracket without guessing its missing text', () => {
    expect(splitProseSentences('It lists 3.5 g. Another value is unknown.')).toEqual(['It lists 3.5 g.', 'Another value is unknown.']);
    expect(splitProseSentences('A value (approx. 99 g')).toEqual(['A value (approx. 99 g']);
  });
});
