import { describe, expect, it } from 'vitest';
import { conversationEvidenceSourceSchema, sourceSchema } from '../../lib/contracts';
import { ingredientFamilyManifest, ingredientFamilySources, lookupIngredientFamilies } from './index';

describe('source-attributed ingredient family lookup', () => {
  it.each([
    ['SODIUM CASEINATE', 'milk'], ['ghee', 'milk'], ['whey protein concentrate', 'milk'],
    ['tofu', 'soy'], ['okara', 'soy'], ['atta', 'wheat'], ['semolina', 'wheat'],
    ['ovalbumin', 'egg'], ['ground nuts', 'peanut'],
  ])('links %s to a source-listed %s relationship', (query, family) => {
    expect(lookupIngredientFamilies(query)).toMatchObject([{ family, sourceId: `health-canada-allergen-${family}` }]);
  });

  it.each(['coconut milk', 'cocoa butter', 'cream of tartar', 'lecithin', 'vegetable protein', 'starch', 'kernels', 'milk-free', 'casein hydrolysate', 'tofu and wheat', 'a'.repeat(241)])('does not infer a family from the incomplete or compound query %s', query => {
    expect(lookupIngredientFamilies(query)).toEqual([]);
  });

  it('preserves section-level lineage, source dates and bounded exportable attribution', () => {
    expect(ingredientFamilyManifest.records).toHaveLength(5);
    const ids = new Set<string>();
    for (const record of ingredientFamilyManifest.records) {
      expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(record.pageModifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ids.has(record.sourceId)).toBe(false);
      ids.add(record.sourceId);
      for (const alias of record.aliases) {
        const matches = lookupIngredientFamilies(alias.name);
        expect(matches).toContainEqual(expect.objectContaining({ sourceId: record.sourceId, sourceSection: alias.section }));
        for (const source of ingredientFamilySources(matches)) {
          expect(sourceSchema.safeParse(source).success).toBe(true);
          expect(conversationEvidenceSourceSchema.safeParse(source).success).toBe(true);
          expect(source.license).toContain('Commercial redistribution requires');
          expect(source.limitations).toContain('not confirmed package presence');
          expect(source.limitations).toContain('does not establish Indian labeling law');
        }
      }
    }
    expect(ingredientFamilySources(lookupIngredientFamilies('whey'))[0].summary).toBe('The Other names for milk section lists whey.');
    expect(lookupIngredientFamilies('ghee')[0].relationship).toBe('source-listed-common-source');
  });
});
