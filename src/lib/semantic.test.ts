import { describe, expect, it } from 'vitest';
import { cosineSimilarity, lexicalRanking, semanticRetrieve } from './semantic';

describe('embedding retrieval integrity', () => {
  it('preserves cosine scaling and orthogonality and rejects invalid vectors', () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 12);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(() => cosineSimilarity([0, 0], [1, 1])).toThrow('Zero vectors');
    expect(() => cosineSimilarity([1], [1, 2])).toThrow('dimensions');
    expect(() => cosineSimilarity([NaN], [1])).toThrow('coordinates');
  });
  it('rejects excessive or empty query inputs before model work', async () => {
    await expect(semanticRetrieve('   ')).rejects.toThrow('Invalid evidence query');
    await expect(semanticRetrieve('a'.repeat(1201))).rejects.toThrow('Invalid evidence query');
    await expect(semanticRetrieve('sodium', 6)).rejects.toThrow('Invalid evidence query');
    await expect(semanticRetrieve('sodium', 1.5)).rejects.toThrow('Invalid evidence query');
  });
  it('lexical baseline uses source terms without synonym boosts', () => {
    const result = lexicalRanking('INS 955');
    expect(result[0].source.id).toBe('fao-955');
    expect(result[0].lexicalScore).toBe(1);
    expect(lexicalRanking('zxxyyq')[0].lexicalScore).toBe(0);
  });
});
