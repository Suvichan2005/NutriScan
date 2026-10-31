import type { EvidenceSource, PackageData, Profile } from '../contracts';
import { containsGuidanceCondition, getNutritionGuidance } from './nutrition-guidance';
import { evidenceSources, findIngredientEvidence } from '../../modules/knowledge';
import { isGuidanceEvidenceInScope } from '../followup-evidence';

/** Select source-linked ingredient/outcome evidence without a network lookup. */
export function packageIngredientContextSources(input: {
  question: string;
  package: Pick<PackageData, 'ingredients' | 'reconstruction'>;
  profile?: Pick<Profile, 'healthConsiderations' | 'goals' | 'country'>;
}): EvidenceSource[] {
  const reconstruction = input.package.reconstruction?.current ? input.package.reconstruction : null;
  const names = reconstruction
    ? reconstruction.ingredients.filter(item => ['clear', 'provisional'].includes(item.status)).map(item => item.normalizedName || item.name)
    : input.package.ingredients;
  const context = [input.question, input.profile?.healthConsiderations, input.profile?.goals].filter(Boolean).join(' ').slice(0, 1200);
  const ids = new Set(names.flatMap(name => findIngredientEvidence(name, context)).flatMap(relation => relation.sourceIds));
  return evidenceSources.filter(source => ids.has(source.id) && isGuidanceEvidenceInScope(source, input.question, input.profile?.country)).slice(0, 3);
}

/** Select compact, local guidance for a shared profile or current question.
 * Package nutrient names help scope guidance when the question refers to the
 * product or portion without naming a nutrient. No profile text is sent to an
 * external search service by this selector.
 */
export function profileGuidanceContextSources(input: {
  question: string;
  historyQuestions?: readonly string[];
  package: {
    nutrients: Array<Pick<PackageData['nutrients'][number], 'key'>>;
    reconstruction?: {
      nutritionRows: Array<Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number], 'nutrient' | 'printedLabel'> & Partial<Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number], 'nutrientKey'>>>;
    } | null;
  };
  profile?: Pick<Profile, 'healthConsiderations' | 'goals' | 'country'>;
}) {
  const condition = [input.profile?.healthConsiderations.trim(), ...[input.question,...(input.historyQuestions??[]).slice(-4)].filter(containsGuidanceCondition)].filter(Boolean).join(' ');
  if (!condition) return [];

  const packageTopics = [
    ...input.package.nutrients.map(nutrient => nutrient.key),
    ...(input.package.reconstruction?.nutritionRows ?? []).map(row => `${row.nutrientKey ?? ''} ${row.nutrient} ${row.printedLabel}`),
  ];
  return getNutritionGuidance({
    query: [input.question, ...packageTopics].filter(Boolean).join(' '),
    condition,
    ...(input.profile?.goals.trim() ? { goal: input.profile.goals } : {}),
    ...(input.profile?.country.trim() ? { jurisdiction: input.profile.country } : {}),
    maxResults: 3,
  });
}

export function addProfileGuidanceContextSources(input: {
  question: string;
  historyQuestions?: readonly string[];
  package: {
    nutrients: Array<Pick<PackageData['nutrients'][number], 'key'>>;
    reconstruction?: {
      nutritionRows: Array<Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number], 'nutrient' | 'printedLabel'> & Partial<Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number], 'nutrientKey'>>>;
    } | null;
  };
  profile?: Pick<Profile, 'healthConsiderations' | 'goals' | 'country'>;
  evidence?: readonly EvidenceSource[];
  allowAutomaticGuidance?: boolean;
}): EvidenceSource[] {
  const existing = [...(input.evidence ?? [])];
  // A controlled capability subset must not receive this source through a
  // hidden pre-generation path when the corresponding tool is unavailable.
  if (input.allowAutomaticGuidance === false) return existing;
  const ids = new Set(existing.map(source => source.id));
  const additions = profileGuidanceContextSources(input)
    .filter(source => !ids.has(source.id))
    .slice(0, Math.max(0, 30 - existing.length));
  return [...existing, ...additions];
}
