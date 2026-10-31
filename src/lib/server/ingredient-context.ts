import { z } from 'zod';
import { evidenceSources, findIngredientEvidence, ingredientFamilySources, lookupAdditive, lookupIngredientFamilies } from '../../modules/knowledge';
import { searchFoodOn, searchOpenFoodTox } from '../../modules/knowledge/server';

const consumerReferences = [
  { names: ['salt'], explanation: 'Salt contributes sodium. The ingredient list alone does not tell you how much sodium is in a serving; check the nutrition panel if it is available.', source: 'WHO · Sodium reduction', url: 'https://www.who.int/news-room/fact-sheets/detail/sodium-reduction' },
  { names: ['hydrogenated vegetable oil', 'partially hydrogenated vegetable oil'], explanation: 'Hydrogenation changes oil. Partially hydrogenated oils can contain industrial trans fat, but this wording alone does not establish how much trans fat this product contains.', source: 'WHO · Trans fat', url: 'https://www.who.int/news-room/fact-sheets/detail/trans-fat/' },
  { names: ['whey', 'whey powder'], explanation: 'Whey is derived from milk. It matters for milk allergy; the ingredient name does not establish the amount of lactose in this product.', source: 'FDA · Food allergies', url: 'https://www.fda.gov/food/buy-store-serve-safe-food/food-allergies-what-you-need-know' },
  { names: ['edible vegetable oil', 'vegetable oil'], explanation: 'Vegetable oils provide fat. Fat composition varies by oil; a generic label does not establish the oil type or its saturated fat content.', source: 'WHO · Healthy diet', url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { names: ['raising agent', 'raising agents'], explanation: 'Raising agents help baked products rise. This describes a function; check the named substance or INS code for its identity.', source: 'FDA · Types of food ingredients', url: 'https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients' },
  { names: ['emulsifier', 'emulsifiers'], explanation: 'Emulsifiers help ingredients mix and stay dispersed. The function name alone does not identify the substance or its amount.', source: 'FDA · Types of food ingredients', url: 'https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients' },
  { names: ['dough conditioner', 'dough conditioners'], explanation: 'Dough conditioners help produce stable dough. This function name alone does not identify the substance used.', source: 'FDA · Types of food ingredients', url: 'https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients' },
  { names: ['acidity regulator', 'acidity regulators'], explanation: 'Acidity regulators help control acidity or alkalinity. Check the printed name or INS code to identify the substance.', source: 'FDA · Types of food ingredients', url: 'https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients' },
  { names: ['refined wheat flour', 'wheat flour', 'maida'], explanation: 'Wheat flour is made from wheat, which matters for wheat allergy. Check the nutrition panel for carbohydrate and fibre amounts rather than estimating them from the ingredient name.', source: 'FDA · Food allergies', url: 'https://www.fda.gov/food/buy-store-serve-safe-food/food-allergies-what-you-need-know' },
  { names: ['corn starch', 'cornstarch', 'maize starch'], explanation: 'Corn starch is a starch ingredient. The ingredient list alone does not establish how much starch is present per serving.', source: 'FDA · Corn starch substance record', url: 'https://hfpappexternal.fda.gov/scripts/Fdcc/index.cfm?id=CORNSTARCH&set=FoodSubstances' },
  { names: ['flour treatment agent', 'flour treatment agents'], explanation: 'This is a functional description, not the name of a particular substance. Check the label and any accompanying INS code for its identity.', source: 'FDA · Types of food ingredients', url: 'https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients' },
];

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
    const matches = foodon.status === 'ok' ? foodon.results.filter(hit => hit.matchedBy !== 'partial-token-overlap').map(hit => ({ id: hit.term.id, label: hit.term.label, matchedBy: hit.matchedBy, matchedText: hit.matchedText })) : [];
    const toxicology = additive ? await searchOpenFoodTox(additive.name, 1) : null;
    const assessment = toxicology?.status === 'ok' ? toxicology.results.find(hit=>hit.matchedBy==='exact-name'||hit.matchedBy==='exact-identifier') : undefined;
    const openFoodTox = toxicology ? { status: toxicology.status, name: assessment?.substance.name ?? null, references: assessment?.substance.references.length ?? 0, source: 'https://www.efsa.europa.eu/en/data-report/chemical-hazards-database-openfoodtox' } : null;
    const consumerReference = consumerReferences.find(entry => entry.names.includes(item.name.trim().toLocaleLowerCase('en-IN'))) ?? null;
    items.push({ name: item.name, code: item.code, identity: additive ? { name: additive.name, code: additive.code, note: additive.note } : null, foodonStatus: foodon.status, matches, families, derivedFamilyMatch, relations, sources, openFoodTox, consumerReference });
  }
  return { items, note: 'Identity candidates and source-linked research do not establish dose, personal effects or safety.' };
}
