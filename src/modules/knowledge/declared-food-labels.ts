export type DeclaredFoodKind = 'allergy' | 'intolerance' | 'avoidance';

export type DeclaredFoodLabelAlias = {
  labelTerm: string;
  sourceIds: string[];
};

type LabelAlias = { text: string; sourceIds?: string[] };
type LabelAliasRule = {
  profileTerms: readonly string[];
  labelTerms: readonly (string | LabelAlias)[];
  kinds: readonly DeclaredFoodKind[];
  sourceIds: readonly string[];
};

const labelAliases: readonly LabelAliasRule[] = [
  {
    profileTerms: ['peanut', 'peanuts', 'groundnut', 'groundnuts'],
    labelTerms: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'peanut oil', 'groundnut oil', 'peanut flour', 'groundnut flour'],
    kinds: ['allergy', 'avoidance'],
    sourceIds: ['fssai-label-allergens-compendium-2025'],
  },
  {
    profileTerms: ['soy', 'soya', 'soybean', 'soybeans'],
    labelTerms: ['soy', 'soya', 'soybean', 'soybeans', 'soy protein', 'soya protein', 'soy flour', 'soya flour', 'soy lecithin', 'soya lecithin'],
    kinds: ['allergy', 'avoidance'],
    sourceIds: ['fssai-label-allergens-compendium-2025'],
  },
  {
    profileTerms: ['milk', 'dairy'],
    labelTerms: [
      'milk', 'milk powder', 'skimmed milk', 'milk solids',
      { text: 'whey', sourceIds: ['fssai-whey-casein-milk-products-2022'] },
      { text: 'whey powder', sourceIds: ['fssai-whey-casein-milk-products-2022'] },
      { text: 'whey protein', sourceIds: ['fssai-whey-casein-milk-products-2022'] },
      { text: 'casein', sourceIds: ['fssai-whey-casein-milk-products-2022'] },
      { text: 'caseinate', sourceIds: ['fssai-whey-casein-milk-products-2022'] },
      { text: 'caseinates', sourceIds: ['fssai-whey-casein-milk-products-2022'] },
    ],
    kinds: ['allergy', 'avoidance'],
    sourceIds: ['fssai-label-allergens-compendium-2025'],
  },
  {
    profileTerms: ['wheat', 'gluten', 'gluten-containing cereals'],
    labelTerms: [
      'wheat', 'wheat flour', 'rye', 'barley', 'spelt',
      { text: 'maida', sourceIds: ['fssai-atta-maida-nomenclature-2019'] },
      { text: 'refined wheat flour', sourceIds: ['fssai-atta-maida-nomenclature-2019'] },
      { text: 'atta', sourceIds: ['fssai-atta-maida-nomenclature-2019'] },
      { text: 'whole wheat flour', sourceIds: ['fssai-atta-maida-nomenclature-2019'] },
    ],
    kinds: ['allergy', 'intolerance', 'avoidance'],
    sourceIds: ['fssai-label-allergens-compendium-2025'],
  },
  {
    profileTerms: ['tree nut', 'tree nuts'],
    labelTerms: ['tree nut', 'tree nuts', 'almond', 'almonds', 'walnut', 'walnuts', 'pistachio', 'pistachios', 'cashew', 'cashews', 'cashew nut', 'cashew nuts'],
    kinds: ['allergy', 'avoidance'],
    sourceIds: ['fssai-label-allergens-compendium-2025'],
  },
];

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordForms = (word: string) => {
  const forms = [word];
  if (word.endsWith('ies') && word.length > 4) forms.push(`${word.slice(0, -3)}y`);
  else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) forms.push(word.slice(0, -1));
  return forms;
};

const containsPhrase = (text: string, term: string) => {
  const words = normalize(text).split(' ').filter(Boolean);
  const target = normalize(term).split(' ').filter(Boolean);
  return target.length > 0 && words.some((_, index) => index + target.length <= words.length && target.every((word, offset) => wordForms(words[index + offset]).some(form => wordForms(word).includes(form))));
};

function normalizeProfileTerm(value: string): string {
  return normalize(value)
    .replace(/^(?:allergy to|allergies to|allergic to|intolerance to|sensitivity to|avoidance of)\s+/, '')
    .replace(/\s+(?:allergy|allergies|intolerance|sensitivity|sensitivities)$/, '')
    .trim();
}

/** Returns terminology evidence only; never implies package presence, exposure, or safety. */
export function lookupDeclaredFoodLabelAlias(kind: DeclaredFoodKind, profileTerm: string, observationText: string): DeclaredFoodLabelAlias | undefined {
  if (profileTerm.length > 120 || observationText.length > 12_000) return undefined;
  const normalizedTerm = normalizeProfileTerm(profileTerm);
  let best: DeclaredFoodLabelAlias | undefined;
  for (const rule of labelAliases) {
    if (!rule.kinds.includes(kind) || !rule.profileTerms.some(term => normalize(term) === normalizedTerm)) continue;
    for (const item of rule.labelTerms) {
      const alias = typeof item === 'string' ? { text: item, sourceIds: [] } : item;
      if (normalize(alias.text) === normalizedTerm || !containsPhrase(observationText, alias.text)) continue;
      if (!best || normalize(alias.text).length > normalize(best.labelTerm).length) {
        best = { labelTerm: alias.text, sourceIds: [...new Set([...rule.sourceIds, ...(alias.sourceIds ?? [])])] };
      }
    }
  }
  return best;
}
