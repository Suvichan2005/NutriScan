import { z } from 'zod';
import { evidenceSources, findIngredientEvidence, ingredientFamilySources, lookupAdditive, lookupIngredientFamilies } from '../../modules/knowledge';
import { searchFoodOn, searchOpenFoodTox } from '../../modules/knowledge/server';

export const ingredientContextInput = z.object({
  items: z.array(z.object({ name: z.string().trim().min(2).max(180), code: z.string().trim().max(40).nullable() }).strict()).max(40),
  question: z.string().max(1200).default(''),
}).strict();

/** Local, source-linked identity and research candidates; never a safety verdict. */
export async function ingredientContext(input: z.infer<typeof ingredientContextInput>) {
  const items = [];
  for (const item of input.items) {
    const additive = lookupAdditive(item.code || item.name);
    const exactFamilies = lookupIngredientFamilies(item.name);
    // A processing-form suffix may prevent an exact terminology match. Keep
    // the shorter name as a candidate, never as a confirmed label fact.
    const baseName = item.name.replace(/\s+(?:powder|flakes|flour|meal)$/iu, '').trim();
    const derivedFamilyMatch = !exactFamilies.length && baseName !== item.name;
    const families = derivedFamilyMatch ? lookupIngredientFamilies(baseName) : exactFamilies;
    const relations = findIngredientEvidence(item.name, input.question);
    const sourceIds = new Set([...(additive?.sourceIds ?? []), ...relations.flatMap(relation => relation.sourceIds)]);
    const sources = [...evidenceSources.filter(source => sourceIds.has(source.id)), ...ingredientFamilySources(families)];
    const foodon = await searchFoodOn(item.name, 2);
    const matches = foodon.status === 'ok' ? foodon.results.map(hit => ({ id: hit.term.id, label: hit.term.label, matchedBy: hit.matchedBy, matchedText: hit.matchedText })) : [];
    const toxicology = additive ? await searchOpenFoodTox(additive.name, 1) : null;
    const assessment = toxicology?.status === 'ok' ? toxicology.results.find(hit=>hit.matchedBy==='exact-name'||hit.matchedBy==='exact-identifier') : undefined;
    const openFoodTox = toxicology ? { status: toxicology.status, name: assessment?.substance.name ?? null, references: assessment?.substance.references.length ?? 0, source: 'https://www.efsa.europa.eu/en/data-report/chemical-hazards-database-openfoodtox' } : null;
    items.push({ name: item.name, code: item.code, identity: additive ? { name: additive.name, code: additive.code, note: additive.note } : null, foodonStatus: foodon.status, matches, families, derivedFamilyMatch, relations, sources, openFoodTox });
  }
  return { items, note: 'Identity candidates and source-linked research do not establish dose, personal effects or safety.' };
}
