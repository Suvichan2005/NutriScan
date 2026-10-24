import type { Observation, PackageData } from './contracts';
import { lookupDeclaredFoodLabelAlias } from './knowledge';

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

export type DeclaredFoodEvidenceType = 'ingredient-list' | 'contains-declaration' | 'precautionary-cross-contact' | 'other-allergen-statement';
export type DeclaredFoodEvidence = {
  type: DeclaredFoodEvidenceType;
  observationId: string;
  text: string;
  matchedLabelTerm: string;
  matchBasis: 'literal' | 'source-backed-alias';
  sourceIds: string[];
  /** Present when the compared wording came from the saved, evidence-linked Gemini interpretation. */
  interpretation?: { packageFactId: string; status: 'clear' | 'provisional' | 'ambiguous' | 'conflict' };
};

export type DeclaredFoodMatch = {
  kind: 'allergy' | 'intolerance' | 'avoidance';
  term: string;
  matched: boolean;
  matchBasis: 'literal' | 'source-backed-alias' | 'none';
  evidence: DeclaredFoodEvidence[];
  observationIds: string[];
  sourceIds: string[];
};

const evidenceType = (observation: Pick<Observation, 'field' | 'text'>): DeclaredFoodEvidenceType => {
  if (observation.field === 'ingredients') return 'ingredient-list';
  if (/^\s*may\s+contain\b/i.test(observation.text)) return 'precautionary-cross-contact';
  if (/^\s*contains\b/i.test(observation.text)) return 'contains-declaration';
  return 'other-allergen-statement';
};

type LabelTextEvidence = {
  type: DeclaredFoodEvidenceType;
  observationId: string;
  text: string;
  interpretation?: DeclaredFoodEvidence['interpretation'];
};

function packageLabelTextEvidence(pkg: PackageData): LabelTextEvidence[] {
  const evidence: LabelTextEvidence[] = pkg.observations
    .filter(observation => observation.field === 'ingredients' || observation.field === 'allergens')
    .map(observation => ({
      type: evidenceType(observation),
      observationId: observation.id,
      text: observation.text,
    }));

  const reconstruction = pkg.reconstruction;
  if (!reconstruction?.current) return evidence;

  reconstruction.ingredients.forEach((ingredient, index) => {
    const text = ingredient.printedText.trim() || ingredient.name;
    if (!text || ingredient.status === 'unreadable' || !ingredient.evidence.observationIds.length) return;
    for (const observationId of ingredient.evidence.observationIds) evidence.push({
      type: 'ingredient-list',
      observationId,
      text,
      interpretation: { packageFactId: `package-fact:ingredient:${index}`, status: ingredient.status },
    });
  });

  reconstruction.statements.forEach((statement, index) => {
    const allergenRelated = ['contains', 'may-contain'].includes(statement.kind)
      || (['precaution', 'warning'].includes(statement.kind) && /\ballergen\b|^\s*(?:may\s+contain|contains)\b/i.test(statement.text));
    if (!allergenRelated || statement.status === 'unreadable' || !statement.evidence.observationIds.length) return;
    for (const observationId of statement.evidence.observationIds) evidence.push({
      type: evidenceType({ field: 'allergens', text: statement.text }),
      observationId,
      text: statement.text,
      interpretation: { packageFactId: `package-fact:statement:${index}`, status: statement.status },
    });
  });

  return evidence;
}

/**
 * Find direct wording and a small, source-backed label-vocabulary crosswalk.
 * These are OCR-linked candidates only: they never establish composition or safety.
 */
export function findDeclaredFoodMentions(pkg: PackageData, declarations: { allergies: string; intolerances: string; avoidedIngredients?: string }): DeclaredFoodMatch[] {
  const observations = packageLabelTextEvidence(pkg);
  return (['allergy', 'intolerance', 'avoidance'] as const).flatMap(kind => {
    const input = kind === 'allergy' ? declarations.allergies : kind === 'intolerance' ? declarations.intolerances : declarations.avoidedIngredients ?? '';
    const terms = [...new Set(input.split(/[,;\n]+/).map(term => term.trim()).filter(Boolean))];
    return terms.map(term => {
      const evidence = observations.flatMap<DeclaredFoodEvidence>(observation => {
        const interpretation = observation.interpretation ? { interpretation: observation.interpretation } : {};
        if (wordsContainPhrase(observation.text, term)) return [{
          type: observation.type, observationId: observation.observationId, text: observation.text,
          matchedLabelTerm: term, matchBasis: 'literal' as const, sourceIds: [], ...interpretation,
        }];
        const alias = lookupDeclaredFoodLabelAlias(kind, term, observation.text);
        return alias ? [{
          type: observation.type, observationId: observation.observationId, text: observation.text,
          matchedLabelTerm: alias.labelTerm, matchBasis: 'source-backed-alias' as const, sourceIds: alias.sourceIds, ...interpretation,
        }] : [];
      });
      const observationIds = [...new Set(evidence.map(item => item.observationId))];
      const matchBasis = evidence.some(item => item.matchBasis === 'literal') ? 'literal' : evidence.length ? 'source-backed-alias' : 'none';
      const sourceIds = [...new Set(evidence.flatMap(item => item.sourceIds))];
      return { kind, term, matched: evidence.length > 0, matchBasis, evidence, observationIds, sourceIds };
    });
  });
}
