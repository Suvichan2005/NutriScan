import type { EvidenceSource, PackageData, Profile } from '../contracts';
import { getNutritionGuidance } from './nutrition-guidance';

/** Select compact, local guidance for an explicitly shared health context.
 * Package nutrient names help scope guidance when the question refers to the
 * product or portion without naming a nutrient. No profile text is sent to an
 * external search service by this selector.
 */
export function profileGuidanceContextSources(input: {
  question: string;
  package: {
    nutrients: Array<Pick<PackageData['nutrients'][number], 'key'>>;
    reconstruction?: {
      nutritionRows: Array<Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number], 'nutrient' | 'printedLabel'> & Partial<Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number], 'nutrientKey'>>>;
    } | null;
  };
  profile?: Pick<Profile, 'healthConsiderations' | 'goals' | 'country'>;
}) {
  const condition = input.profile?.healthConsiderations.trim();
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
