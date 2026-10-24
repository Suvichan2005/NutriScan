import { describe, expect, it } from 'vitest';
import { clearsLocalEvidenceFloor, cosineSimilarity, isCurrentLawOrRegulatoryQuery, lexicalRanking, localEvidenceScoreFloor, semanticRetrieve } from './semantic';

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
  it('suppresses current-law requests from the static scientific corpus', async () => {
    const result = await semanticRetrieve('Is an ORS food product name currently allowed in India?', 3);
    expect(result.status).toBe('no_match');
    expect(result.results).toEqual([]);
    expect(result.message).toMatch(/not a current-law source/i);
    expect(isCurrentLawOrRegulatoryQuery('INS 955 sucralose identity')).toBe(false);
    expect(isCurrentLawOrRegulatoryQuery('Is INS 955 allowed in this product category?')).toBe(true);
    expect(isCurrentLawOrRegulatoryQuery('What is the current FSSAI labelling rule?')).toBe(true);
  });
  it('retrieves the new India-relevant allergen and milk-derivative references locally', async () => {
    const labelTerms = await semanticRetrieve('Indian packaged food allergen label terms peanut soy gluten', 4);
    expect(labelTerms.results[0]?.source.id).toBe('fssai-label-allergens-compendium-2025');
    const milkTerms = await semanticRetrieve('whey powder casein milk-derived products', 4);
    expect(milkTerms.results[0]?.source.id).toBe('fssai-whey-casein-milk-products-2022');
    expect(milkTerms.results[0]?.source.summary).toMatch(/whey powders as milk products/i);
  });
  it('retrieves oat beta-glucan evidence by the outcome asked about', async () => {
    const lipidEvidence = await semanticRetrieve('What does oat beta-glucan do for cholesterol in adults?', 5);
    expect(lipidEvidence.results[0]?.source.id).toBe('pubmed-oat-beta-glucan-lipids-2022');
    const glucosePeakEvidence = await semanticRetrieve('Do oat beta-glucans reduce post-meal glucose peaks and what amounts were studied?', 5);
    expect(glucosePeakEvidence.results[0]?.source.id).toBe('efsa-oat-beta-glucan-glycaemic-peak-2026');
    const lowerDoseEvidence = await semanticRetrieve('What did EFSA conclude about a lower oat beta-glucan dose and postprandial glycaemic response?', 5);
    expect(lowerDoseEvidence.results[0]?.source.id).toBe('efsa-oat-barley-beta-glucan-glycaemic-2025');
  });
  it('uses a finite, conservative local candidate floor without treating it as a probability', () => {
    expect(localEvidenceScoreFloor).toBe(0.4);
    expect(clearsLocalEvidenceFloor(0.39999)).toBe(false);
    expect(clearsLocalEvidenceFloor(0.4)).toBe(true);
    expect(clearsLocalEvidenceFloor(Number.NaN)).toBe(false);
    expect(clearsLocalEvidenceFloor(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
