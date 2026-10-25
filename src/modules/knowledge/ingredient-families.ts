import data from './ingredient-families.data.json';
import type { EvidenceSource } from '../../lib/contracts';

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-IN')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

export type IngredientFamilyMatch = {
  family: string;
  matchedName: string;
  sourceId: string;
  sourceSection: string;
  relationship: 'source-listed-name' | 'source-listed-common-source';
};

/** Exact reference lookup, not package detection, a semantic classifier or a safety decision.
 * Never search inside a whole ingredient list: e.g. coconut milk != milk.
 * A missing match establishes no absence, and all matching families are retained.
 */
export function lookupIngredientFamilies(query: string): IngredientFamilyMatch[] {
  if (query.length < 2 || query.length > 240) return [];
  const term = normalize(query);
  return data.records.flatMap(record => record.aliases
    .filter(alias => normalize(alias.name) === term)
    .map(alias => ({
      family: record.family, matchedName: alias.name, sourceId: record.sourceId,
      sourceSection: alias.section,
      relationship: alias.section.startsWith('Common sources')
        ? 'source-listed-common-source' as const : 'source-listed-name' as const,
    })));
}

export function ingredientFamilySources(matches: readonly IngredientFamilyMatch[]): EvidenceSource[] {
  return data.records.filter(record => matches.some(match => match.sourceId === record.sourceId)).map(record => {
    const selected = matches.filter(match => match.sourceId === record.sourceId);
    return {
      id: record.sourceId, title: record.title, publisher: 'Health Canada', url: record.url,
      category: 'registry', jurisdiction: 'Canada', publishedAt: null, effectiveAt: null,
      retrievedAt: record.reviewedAt,
      summary: selected.map(match => `The ${match.sourceSection} section lists ${match.matchedName}.`).join(' '),
      limitations: 'Ingredient-name/source association only, not confirmed package presence, protein content, exposure, individual reaction or absence of other allergens. Clinical applicability requires separate evidence. Canadian educational material does not establish Indian labeling law. Page modified ' + record.pageModifiedAt + '; reviewed ' + record.reviewedAt + '. Lists are incomplete; verify current package and manufacturer information.',
      license: data.reuse + ' Health Canada; original title and URL recorded above. Policy: ' + data.policyUrl,
    };
  });
}

export const ingredientFamilyManifest = data;
