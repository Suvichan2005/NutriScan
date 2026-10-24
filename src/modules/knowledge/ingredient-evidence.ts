/**
 * Source-linked ingredient/outcome pathways. These connect a recognized label
 * ingredient to relevant evidence without treating presence as dose or effect.
 */
export type IngredientEvidenceRelation = {
  id: string;
  ingredient: string;
  aliases: readonly string[];
  outcome: string;
  population: string;
  exposureContext: string;
  sourceIds: readonly string[];
  limitations: string;
  topicTerms: readonly string[];
};

export const ingredientEvidenceRelations: readonly IngredientEvidenceRelation[] = [
  {
    id: 'oat-beta-glucan-lipid-outcomes',
    ingredient: 'Oat beta-glucan',
    aliases: ['oat beta-glucan', 'beta-glucan from oats', 'oat bran', 'oats', 'oat'],
    outcome: 'Oat beta-glucan interventions have been studied for total and LDL cholesterol outcomes.',
    population: 'The linked meta-analysis included trials in hypercholesterolemic adults; it is not an India-specific clinical guideline.',
    exposureContext: 'Intervention evidence concerns beta-glucan intake, not an ordinary serving of a product that merely lists oats.',
    sourceIds: ['pubmed-oat-beta-glucan-lipids-2022'],
    limitations: 'A package ingredient declaration does not establish beta-glucan content, dose, food-matrix effect, exposure, or an individual lipid response.',
    topicTerms: ['cholesterol', 'ldl', 'lipid', 'heart', 'cardiovascular'],
  },
  {
    id: 'oat-beta-glucan-postprandial-glucose',
    ingredient: 'Oat beta-glucan',
    aliases: ['oat beta-glucan', 'beta-glucan from oats', 'oat bran', 'oats', 'oat'],
    outcome: 'EFSA assessed evidence for postprandial glucose peaks separately from postprandial glucose incremental area under the curve.',
    population: 'The 2026 opinion describes individuals who wish to reduce postprandial glucose peaks; it is not diabetes-specific clinical guidance.',
    exposureContext: 'The 2026 assessed claim condition is at least 3 g oat beta-glucan per 30 g available carbohydrate in a portion containing at least 30 g available carbohydrate. A separate 2025 opinion did not establish a consistent iAUC effect under a proposed lower condition of at least 2 g per 30 g available carbohydrate.',
    sourceIds: ['efsa-oat-beta-glucan-glycaemic-peak-2026', 'efsa-oat-barley-beta-glucan-glycaemic-2025'],
    limitations: 'These are EU scientific opinions on defined endpoints and conditions, not Indian claim law, treatment advice, or an individual target. Oats on a package do not establish beta-glucan quantity or a glucose response.',
    topicTerms: ['glucose', 'glycemic', 'glycaemic', 'blood sugar', 'postprandial', 'diabetes', 'diabetic'],
  },
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-IN')
    .replace(/β/g, 'beta')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedPhrase = ` ${normalize(phrase)} `;
  return normalizedPhrase.length > 2 && normalizedText.includes(normalizedPhrase);
}

/** Return only source-linked outcomes relevant to both the ingredient and question. */
export function findIngredientEvidence(ingredientQuery: string, question = ''): IngredientEvidenceRelation[] {
  if (ingredientQuery.length > 240 || question.length > 1200) return [];
  const relationMatches = ingredientEvidenceRelations.filter(relation =>
    relation.aliases.some(alias => containsPhrase(ingredientQuery, alias))
  );
  if (!relationMatches.length) return [];

  const combinedContext = `${ingredientQuery} ${question}`;
  return relationMatches.filter(relation =>
    relation.topicTerms.some(term => containsPhrase(combinedContext, term))
  ).slice(0, 3);
}
