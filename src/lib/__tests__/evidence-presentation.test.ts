import { describe, expect, it } from 'vitest';
import { evidenceSourcePreview } from '../evidence-presentation';

describe('evidence source presentation', () => {
  it('does not present a generated Google grounding segment as a source summary', () => {
    const preview = evidenceSourcePreview({
      category: 'web-search',
      summary: 'The generated response claims an exposure above 1.2 mg/kg per day.',
    });
    expect(preview.label).toMatch(/Google Search link.*page content not reviewed/i);
    expect(preview.text).toMatch(/not fetched or checked/i);
    expect(preview.text).not.toContain('1.2 mg/kg');
  });

  it('continues to show the stored summary for other source records', () => {
    expect(evidenceSourcePreview({ category: 'guideline', summary: 'Adults should limit sodium.' })).toEqual({
      label: 'NUTRISCAN SUMMARY · CHECK ORIGINAL SOURCE',
      text: 'Adults should limit sodium.',
    });
  });
});
