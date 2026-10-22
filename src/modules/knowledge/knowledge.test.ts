import { describe, expect, it } from 'vitest';
import { sourceSchema } from '../../lib/contracts';
import { clearsLocalEvidenceFloor, localEvidenceScoreFloor } from './server';
import {
  additives,
  detectAdditives,
  evidenceSources,
  findNutrientContentClaimGuidance,
  lookupAdditive,
  lookupExplicitAdditiveMention,
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

  it('resolves lecithin family codes and silica while retaining source limits', () => {
    expect(lookupAdditive('INS 322')).toMatchObject({ code: '322', name: 'Lecithins', sourceIds: ['fao-322'] });
    expect(lookupAdditive('E322(ii)')?.note).toMatch(/does not establish subtype/i);
    expect(lookupAdditive('phospholipids')?.code).toBe('322');
    expect(lookupAdditive('INS 551')).toMatchObject({ code: '551', name: 'Silicon dioxide, amorphous', sourceIds: ['fao-551'] });
    expect(lookupAdditive('silica')?.code).toBe('551');
    expect(detectAdditives('Ingredients: soy lecithin, INS 322(ii), silica, E551')).toEqual(['322', '551']);
  });

  it('retrieves only a single explicitly prefixed additive code from natural-language context', () => {
    expect(lookupExplicitAdditiveMention('What does INS 322 mean on this label?')?.sourceIds).toEqual(['fao-322']);
    expect(lookupExplicitAdditiveMention('Is E322(ii) the same lecithin family?')?.code).toBe('322');
    expect(lookupExplicitAdditiveMention('The serving is 322 mg')).toBeUndefined();
    expect(lookupExplicitAdditiveMention('Compare INS 322 with E551')).toBeUndefined();
  });

  it('extracts additive codes from label text without inferring a nutrient value or dose', () => {
    expect(detectAdditives('Ingredients: water, preservative (202), INS 955')).toEqual(['955', '202']);
    expect(additives.length).toBeGreaterThan(0);
  });

  it('retrieves an attributed identity record for an exact code and keeps claim matching separate', () => {
    const hit = retrieveEvidence('INS 955', 4)[0];
    expect(hit.source.id).toBe('fao-955');
    expect(hit.source.publisher).toMatch(/FAO/i);
    expect(retrieveEvidence('INS 322', 4).some((item) => item.source.id === 'fao-322')).toBe(true);
    expect(retrieveEvidence('INS 551', 4).some((item) => item.source.id === 'fao-551')).toBe(true);
    expect(findNutrientContentClaimGuidance('high protein snack').map((item) => item.key)).toContain('high-protein');
  });

  it('rejects invalid limits instead of silently broadening a retrieval request', () => {
    expect(() => retrieveEvidence('sodium', 0)).toThrow(/limit/i);
    expect(() => retrieveEvidence('x'.repeat(4001), 4)).toThrow(/too long/i);
  });

  it('suppresses candidates below the explicitly uncalibrated local relevance floor', () => {
    expect(localEvidenceScoreFloor).toBe(0.4);
    expect(clearsLocalEvidenceFloor(0.4)).toBe(true);
    expect(clearsLocalEvidenceFloor(0.3999)).toBe(false);
    expect(clearsLocalEvidenceFloor(Number.NaN)).toBe(false);
    expect(clearsLocalEvidenceFloor(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
