import type { Observation, PackageData } from './contracts';

export type DeclaredFoodMatch = {
  kind: 'allergy' | 'intolerance';
  term: string;
  matched: boolean;
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

/** Surface literal mentions only; never infer medical safety, synonyms or cross-contact. */
export function findDeclaredFoodMentions(pkg: PackageData, declarations: { allergies: string; intolerances: string }): DeclaredFoodMatch[] {
  const labelTexts = [...pkg.ingredients, ...pkg.allergens];
  const observations: Observation[] = pkg.observations.filter(o => o.field === 'ingredients' || o.field === 'allergens');
  return (['allergy', 'intolerance'] as const).flatMap(kind => {
    const input = kind === 'allergy' ? declarations.allergies : declarations.intolerances;
    const terms = [...new Set(input.split(/[,;\n]+/).map(term => term.trim()).filter(Boolean))];
    return terms.map(term => {
      const matched = labelTexts.some(text => wordsContainPhrase(text, term));
      const observationIds = matched ? observations.filter(o => wordsContainPhrase(o.text, term)).map(o => o.id) : [];
      return { kind, term, matched, observationIds };
    });
  });
}
