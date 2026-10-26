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
    id: 'oat-beta-glucan-postprandial-glucose-peak-2026',
    ingredient: 'Oat beta-glucan',
    aliases: ['oat beta-glucan', 'beta-glucan from oats', 'oat bran', 'oats', 'oat'],
    outcome: 'EFSA’s 2026 opinion concluded that oat beta-glucans can reduce postprandial glucose peaks under the assessed claim conditions.',
    population: 'The 2026 opinion describes individuals who wish to reduce postprandial glucose peaks; it is not diabetes-specific clinical guidance.',
    exposureContext: 'The assessed condition is at least 3 g oat beta-glucan per 30 g available carbohydrate in a portion containing at least 30 g available carbohydrate.',
    sourceIds: ['efsa-oat-beta-glucan-glycaemic-peak-2026'],
    limitations: 'This is an EU scientific opinion on a defined endpoint and condition, not Indian claim law, treatment advice, or an individual target. Oats on a package do not establish beta-glucan quantity or a glucose response.',
    topicTerms: ['glucose', 'glycemic', 'glycaemic', 'blood sugar', 'postprandial', 'diabetes', 'diabetic'],
  },
  {
    id: 'oat-beta-glucan-postprandial-glucose-iAUC-2025',
    ingredient: 'Oat and barley beta-glucans',
    aliases: ['oat beta-glucan', 'beta-glucan from oats', 'oat bran', 'oats', 'oat', 'barley beta-glucan'],
    outcome: 'EFSA’s 2025 opinion did not establish a consistent reduction in postprandial glucose incremental area under the curve under the proposed conditions.',
    population: 'The 2025 opinion assessed proposed food-claim substantiation; it is not diabetes-specific clinical guidance.',
    exposureContext: 'The proposed condition assessed at least 2 g oat or barley beta-glucan per 30 g available carbohydrate.',
    sourceIds: ['efsa-oat-barley-beta-glucan-glycaemic-2025'],
    limitations: 'This is an EU scientific opinion on a distinct endpoint and proposed condition, not Indian claim law, treatment advice, or an individual target. Do not conflate it with the 2026 glucose-peak opinion.',
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

/** Curated subject links for a source; exact source identity is required. */
export function ingredientEvidenceForSource(sourceId: string): IngredientEvidenceRelation[] {
  return ingredientEvidenceRelations.filter(relation => relation.sourceIds.includes(sourceId));
}

/** Match a named ingredient entity without treating a related outcome as proof. */
export function ingredientEvidenceSubjectInText(text: string, relation: IngredientEvidenceRelation): boolean {
  return relation.aliases.some(alias => containsPhrase(text, alias));
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
