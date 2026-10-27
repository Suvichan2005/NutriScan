import { describe, expect, it } from 'vitest';
import { splitProseSentences, removeEmptyProseSections } from '../prose-sentences';

describe('coherent prose validation boundaries', () => {
  it('removes emptied section shells while preserving a parent and its populated list',()=>{
    const answer='**Conclusion**\n---\n### Values\n* **Protein:**\n* **Carbohydrate:**\n  * A recorded result remains.\n### Uncertainty\nThe source is provisional.';
    const result=removeEmptyProseSections(answer);
    expect(result).not.toContain('**Conclusion**');expect(result).not.toContain('**Protein:**');
    expect(result).toContain('### Values');expect(result).toContain('**Carbohydrate:**');expect(result).toContain('The source is provisional.');
  });
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
