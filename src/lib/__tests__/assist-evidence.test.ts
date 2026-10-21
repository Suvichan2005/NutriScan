import { describe, expect, it } from 'vitest';
import type { EvidenceSource, ResearchItem } from '../contracts';
import { assistEvidenceContext } from '../assist-evidence';

const source = (id: string): EvidenceSource => ({
  id, title: `Reference ${id}`, publisher: 'WHO', url: `https://example.org/${id}`,
  category: 'guideline', jurisdiction: 'global', publishedAt: null, effectiveAt: null,
  retrievedAt: '2026-10-21T12:00:00.000Z', summary: `Evidence summary ${id}`,
  limitations: 'Population guidance only.'
});

const researchItem = (id: string, category: string, summary = `Search result ${id}`): ResearchItem => ({
  id, title: `Search result ${id}`, url: `https://example.org/${id}`, publisher: 'Example publisher',
  publishedAt: '2024-01-01', retrievedAt: '2026-10-21T12:00:00.000Z', category, summary,
  limitations: 'Search match only; read the original before drawing conclusions.'
});

describe('assist evidence context', () => {
  it('combines local, semantic and user-requested research references while retaining source limits', () => {
    const local = source('who-guidance');
    const result = assistEvidenceContext({
      auditSources: [local],
      localSearch: [{ ...local, score: 0.91 }, { ...source('who-sodium'), score: 0.78 }],
      research: [researchItem('epmc-trial', 'Randomized Controlled Trial', 'An abstract describing a food study.')]
    });

    expect(result.map(item => item.id)).toEqual(['who-guidance', 'who-sodium', 'epmc-trial']);
    expect(result[2]).toMatchObject({
      category: 'literature', jurisdiction: 'Not specified by the search result',
      summary: 'Search classification: Randomized Controlled Trial\nAn abstract describing a food study.',
      limitations: 'Search match only; read the original before drawing conclusions.'
    });
  });

  it('bounds the source count and summary text and drops invalid URLs', () => {
    const result = assistEvidenceContext({
      auditSources: Array.from({ length: 6 }, (_, index) => source(`local-${index}`)),
      localSearch: Array.from({ length: 3 }, (_, index) => ({ ...source(`semantic-${index}`), score: 0.5 })),
      research: Array.from({ length: 7 }, (_, index) => researchItem(`research-${index}`, 'Population guideline', 'x'.repeat(5000)))
    });
    expect(result).toHaveLength(15);
    expect(result.every(item => item.summary.length <= 1600)).toBe(true);

    const invalid = assistEvidenceContext({ auditSources: [], localSearch: [], research: [{ ...researchItem('bad-url', 'literature'), url: 'http://example.org/not-https' }] });
    expect(invalid).toEqual([]);
  });
});
