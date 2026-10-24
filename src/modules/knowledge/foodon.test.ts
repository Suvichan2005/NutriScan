import { describe, expect, it } from 'vitest';
import { rankFoodOnTerms, searchFoodOn } from './server';

describe('pinned local FoodOn ingredient index', () => {
  it('loads the attributed 2026-09-20 release and retrieves a real exact synonym with hierarchy', async () => {
    const result = await searchFoodOn('white flour');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.source).toMatchObject({
      version: '2026-09-20',
      repositoryCommit: 'cd73540243a84bcd511a500d9a497d12d7dc02f6',
      license: 'CC BY 4.0',
      ontologySha256: 'b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf',
    });
    expect(result.results[0]).toMatchObject({
      term: { id: 'FOODON_03302339', label: 'white wheat flour' },
      matchedBy: 'exact-synonym', matchedText: 'white flour',
    });
    expect(result.results[0].parents.some(parent => /wheat flour/i.test(parent.label))).toBe(true);
  });

  it('finds Indian-market flour terms and other food categories without inventing the absent maida alias', async () => {
    const [rice, oil, atta, besan, absentAlias] = await Promise.all([
      searchFoodOn('rice flour'),
      searchFoodOn('palm oil'),
      searchFoodOn('atta'),
      searchFoodOn('besan'),
      searchFoodOn('maida'),
    ]);
    expect(rice.status).toBe('ok');
    if (rice.status === 'ok') expect(rice.results.some(hit => /rice flour/i.test(hit.term.label))).toBe(true);
    expect(oil.status).toBe('ok');
    if (oil.status === 'ok') expect(oil.results.some(hit => hit.term.id === 'FOODON_03310232')).toBe(true);
    expect(atta.status).toBe('ok');
    if (atta.status === 'ok') expect(atta.results[0]).toMatchObject({ term: { id: 'FOODON_03540094' }, matchedBy: 'exact-synonym', matchedText: 'atta' });
    expect(besan.status).toBe('ok');
    if (besan.status === 'ok') expect(besan.results[0]).toMatchObject({ term: { id: 'FOODON_03601071', label: 'gram flour' }, matchedBy: 'exact-synonym', matchedText: 'besan' });
    expect(absentAlias.status).toBe('no_match');
  });

  it('rejects unbounded requests instead of broadening index search', () => {
    expect(() => rankFoodOnTerms('x', [])).toThrow(/invalid FoodOn/i);
    expect(() => rankFoodOnTerms('wheat flour', [], 6)).toThrow(/invalid FoodOn/i);
  });
});
