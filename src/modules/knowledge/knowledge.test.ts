import { describe, expect, it } from 'vitest';
import { sourceSchema } from '../../lib/contracts';
import {
  additives,
  detectAdditives,
  evidenceSources,
  findNutrientContentClaimGuidance,
  lookupAdditive,
  resolveTentativeAdditiveIdentity,
  retrieveEvidence,
} from './index';

describe('knowledge module offline contract', () => {
  it('keeps source identifiers unique and every curated record compatible with the shared contract', () => {
    const ids = evidenceSources.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(evidenceSources.length).toBeGreaterThan(0);
    for (const source of evidenceSources) expect(sourceSchema.safeParse(source).success).toBe(true);
  });

  it('resolves exact additive identifiers while keeping fuzzy OCR interpretation tentative', () => {
    expect(lookupAdditive('INS 955')?.name).toBe('Sucralose');
    expect(lookupAdditive('trichlorogalactosucrose')?.code).toBe('955');
    expect(lookupAdditive('955 mg')).toBeUndefined();

    const candidate = resolveTentativeAdditiveIdentity('Calciurn disodium edetate');
    expect(candidate).toMatchObject({ status: 'tentative', kind: 'additive-identity-candidate', code: '385' });
    expect(candidate?.observedText).toBe('Calciurn disodium edetate');
    expect(candidate?.sourceIds).toContain('fao-385');
  });

  it('extracts additive codes from label text without inferring a nutrient value or dose', () => {
    expect(detectAdditives('Ingredients: water, preservative (202), INS 955')).toEqual(['955', '202']);
    expect(additives.length).toBeGreaterThan(0);
  });

  it('retrieves an attributed identity record for an exact code and keeps claim matching separate', () => {
    const hit = retrieveEvidence('INS 955', 4)[0];
    expect(hit.source.id).toBe('fao-955');
    expect(hit.source.publisher).toMatch(/FAO/i);
    expect(findNutrientContentClaimGuidance('high protein snack').map((item) => item.key)).toContain('high-protein');
  });

  it('rejects invalid limits instead of silently broadening a retrieval request', () => {
    expect(() => retrieveEvidence('sodium', 0)).toThrow(/limit/i);
    expect(() => retrieveEvidence('x'.repeat(4001), 4)).toThrow(/too long/i);
  });
});
