import type { Observation, PackageData } from './contracts';

export type DeclaredFoodEvidenceType = 'ingredient-list' | 'contains-declaration' | 'precautionary-cross-contact' | 'other-allergen-statement';
export type DeclaredFoodEvidence = {
  type: DeclaredFoodEvidenceType;
  observationId: string;
  text: string;
};

export type DeclaredFoodMatch = {
  kind: 'allergy' | 'intolerance';
  term: string;
  matched: boolean;
  evidence: DeclaredFoodEvidence[];
  observationIds: string[];
};

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordForms = (word: string) => {
  const forms = [word];
  if (word.endsWith('ies') && word.length > 4) forms.push(`${word.slice(0, -3)}y`);
  else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) forms.push(word.slice(0, -1));
  return forms;
};
const wordsContainPhrase = (text: string, term: string) => {
  const words = normalize(text).split(' ').filter(Boolean);
  const target = normalize(term).split(' ').filter(Boolean);
  return target.length > 0 && words.some((_, index) => index + target.length <= words.length && target.every((word, offset) => wordForms(words[index + offset]).some(form => wordForms(word).includes(form))));
};
const evidenceType = (observation: Observation): DeclaredFoodEvidenceType => {
  if (observation.field === 'ingredients') return 'ingredient-list';
  if (/^\s*may\s+contain\b/i.test(observation.text)) return 'precautionary-cross-contact';
  if (/^\s*contains\b/i.test(observation.text)) return 'contains-declaration';
  return 'other-allergen-statement';
};

/** Surface literal mentions only; label wording categories are observations, not verified composition or safety. */
export function findDeclaredFoodMentions(pkg: PackageData, declarations: { allergies: string; intolerances: string }): DeclaredFoodMatch[] {
  const observations: Observation[] = pkg.observations.filter(o => o.field === 'ingredients' || o.field === 'allergens');
  return (['allergy', 'intolerance'] as const).flatMap(kind => {
    const input = kind === 'allergy' ? declarations.allergies : declarations.intolerances;
    const terms = [...new Set(input.split(/[,;\n]+/).map(term => term.trim()).filter(Boolean))];
    return terms.map(term => {
      const evidence = observations.filter(o => wordsContainPhrase(o.text, term)).map(observation => ({
        type: evidenceType(observation), observationId: observation.id, text: observation.text,
      }));
      const observationIds = [...new Set(evidence.map(item => item.observationId))];
      return { kind, term, matched: evidence.length > 0, evidence, observationIds };
    });
  });
}
