import { describe, expect, it } from 'vitest';
import { sourceSchema } from '../../lib/contracts';
import { clearsLocalEvidenceFloor, localEvidenceScoreFloor, rankOpenFoodToxSubstances, type OpenFoodToxSubstance } from './server';
import {
  additives,
  detectAdditives,
  evidenceSources,
  findNutrientContentClaimGuidance,
  findIngredientEvidence,
  indianStapleIdentities,
  indianStapleIdentitySources,
  lookupAdditive,
  lookupExplicitAdditiveMention,
  lookupDeclaredFoodLabelAlias,
  lookupIndianStapleIngredientIdentity,
  resolveTentativeAdditiveIdentity,
  retrieveEvidence,
} from './index';

describe('knowledge module offline contract', () => {
  it('keeps source identifiers unique and every curated record compatible with the shared contract', () => {
    const ids = evidenceSources.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(evidenceSources.length).toBeGreaterThan(0);
    for (const source of evidenceSources) expect(sourceSchema.safeParse(source).success).toBe(true);
    for (const source of indianStapleIdentitySources) expect(sourceSchema.safeParse(source).success).toBe(true);
    const allIds = [...ids, ...indianStapleIdentitySources.map(source => source.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('normalizes exact Indian staple label aliases with FSSAI provenance and abstains on ambiguous terms', () => {
    expect(indianStapleIdentities).toHaveLength(3);
    expect(lookupIndianStapleIngredientIdentity('Refined wheat flour (Maida) 89.98%')).toMatchObject({
      status: 'tentative', kind: 'regional-ingredient-identity-candidate', canonicalName: 'Refined wheat flour (maida)',
      matchedAlias: 'refined wheat flour', sourceId: 'fssai-atta-maida-nomenclature-2019',
      interpretation: 'terminology-only; package-presence-not-established',
    });
    expect(lookupIndianStapleIngredientIdentity('atta')?.canonicalName).toBe('Whole wheat flour (atta)');
    expect(lookupIndianStapleIngredientIdentity('RAWa')).toMatchObject({ canonicalName: 'Semolina (suji or rawa)', sourceId: 'fssai-semolina-suji-rawa-standard-2023' });
    expect(lookupIndianStapleIngredientIdentity('wheat flour')).toBeUndefined();
    expect(lookupIndianStapleIngredientIdentity('maida and atta')).toBeUndefined();
    expect(lookupIndianStapleIngredientIdentity('x'.repeat(241))).toBeUndefined();
  });

  it('matches declared restriction concepts to source-backed Indian label terms without a safety verdict', () => {
    expect(lookupDeclaredFoodLabelAlias('allergy', 'peanuts', 'Ingredients: groundnut oil')).toEqual({
      labelTerm: 'groundnut oil', sourceIds: ['fssai-label-allergens-compendium-2025'],
    });
    expect(lookupDeclaredFoodLabelAlias('allergy', 'milk', 'Ingredients: whey powder')).toEqual({
      labelTerm: 'whey powder', sourceIds: ['fssai-label-allergens-compendium-2025', 'fssai-whey-casein-milk-products-2022'],
    });
    expect(lookupDeclaredFoodLabelAlias('intolerance', 'lactose', 'Ingredients: whey powder')).toBeUndefined();
    expect(lookupDeclaredFoodLabelAlias('intolerance', 'gluten', 'Ingredients: refined wheat flour (maida)')).toMatchObject({
      labelTerm: 'refined wheat flour', sourceIds: expect.arrayContaining(['fssai-atta-maida-nomenclature-2019']),
    });
    expect(lookupDeclaredFoodLabelAlias('allergy', 'cashew', 'Ingredients: almond flour')).toBeUndefined();
    expect(lookupDeclaredFoodLabelAlias('intolerance', 'gluten', 'Ingredients: oats')).toBeUndefined();
  });

  it('links ordinary oat ingredients to outcome-specific evidence without inferring package dose or effect', () => {
    expect(findIngredientEvidence('oats', 'Could oat beta-glucan affect cholesterol?')).toMatchObject([
      { id: 'oat-beta-glucan-lipid-outcomes', sourceIds: ['pubmed-oat-beta-glucan-lipids-2022'] },
    ]);
    expect(findIngredientEvidence('rolled oats', 'What evidence is there about post-meal glucose peaks?')).toMatchObject([
      { id: 'oat-beta-glucan-postprandial-glucose-peak-2026', sourceIds: ['efsa-oat-beta-glucan-glycaemic-peak-2026'] },
      { id: 'oat-beta-glucan-postprandial-glucose-iAUC-2025', sourceIds: ['efsa-oat-barley-beta-glucan-glycaemic-2025'] },
    ]);
    expect(findIngredientEvidence('oats', 'What is the serving size?')).toEqual([]);
    expect(findIngredientEvidence('almonds', 'Can this affect cholesterol?')).toEqual([]);
    expect(findIngredientEvidence('oats', 'Could this change cholesterol?')[0].limitations).toMatch(/does not establish.*dose/i);
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

  it('ranks EFSA substance names and exact registry identifiers without matching generic fragments', () => {
    const tbhq: OpenFoodToxSubstance = {
      substanceId: 'sub-tbhq', name: 'Tertiary-butyl hydroquinone (TBHQ)', referenceSubstanceId: 'ref-tbhq',
      aliases: ['Tertiary-butyl hydroquinone (TBHQ)', 'tert-Butylhydroquinone'],
      identifiers: { casNumber: '1948-33-0', pubchemCid: 16043 }, type: ['mono-constituent substance'], references: [],
      assessments: [{ assessmentId: 'assessment-tbhq', adi: { 'Adi.lowerValue': 0.7, 'Adi.Unit': 'mg/kg bw/day' }, acuteReferenceDose: null }],
    };
    const unrelated: OpenFoodToxSubstance = {
      substanceId: 'sub-hydroquinone', name: 'Hydroquinone', referenceSubstanceId: 'ref-hydroquinone',
      aliases: ['Hydroquinone'], identifiers: { casNumber: '123-31-9' }, type: [], references: [], assessments: [],
    };
    expect(rankOpenFoodToxSubstances('TBHQ', [unrelated, tbhq])).toMatchObject([{ substance: { substanceId: 'sub-tbhq' }, matchedBy: 'exact-name' }]);
    expect(rankOpenFoodToxSubstances('1948-33-0', [unrelated, tbhq])).toMatchObject([{ substance: { substanceId: 'sub-tbhq' }, matchedBy: 'exact-identifier' }]);
    expect(rankOpenFoodToxSubstances('hydro', [unrelated, tbhq])).toEqual([]);
    expect(() => rankOpenFoodToxSubstances('TBHQ', [tbhq], 0)).toThrow(/request/i);
  });
});
