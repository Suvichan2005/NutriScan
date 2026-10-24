import { describe, expect, it } from 'vitest';
import { findDeclaredFoodMentions } from '../ingredient-context';
import { parseLabel } from '../parser';

describe('declared allergy and intolerance label mentions', () => {
  it('returns literal ingredient/allergen text matches with supporting observations', () => {
    const pkg = parseLabel('Ingredients: Milk powder, sugar\nContains: Milk');
    const result = findDeclaredFoodMentions(pkg, { allergies: 'milk', intolerances: '' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'allergy', term: 'milk', matched: true });
    expect(result[0].observationIds).toHaveLength(2);
    expect(pkg.observations.map(o => o.id)).toEqual(expect.arrayContaining(result[0].observationIds));
  });
  it('preserves exact matched lines and distinguishes ingredient, Contains, and May-contain wording', () => {
    const ingredientLine = 'Ingredients: Whole milk powder, oats';
    const containsLine = 'Contains: Milk';
    const mayContainLine = 'May contain traces of milk';
    const pkg = parseLabel([ingredientLine, containsLine, mayContainLine].join('\n'));
    const result = findDeclaredFoodMentions(pkg, { allergies: 'milk', intolerances: '' })[0];
    expect(result.evidence).toEqual([
      { type: 'ingredient-list', observationId: pkg.observations.find(o => o.text === ingredientLine)?.id, text: ingredientLine, matchedLabelTerm: 'milk', matchBasis: 'literal', sourceIds: [] },
      { type: 'contains-declaration', observationId: pkg.observations.find(o => o.text === containsLine)?.id, text: containsLine, matchedLabelTerm: 'milk', matchBasis: 'literal', sourceIds: [] },
      { type: 'precautionary-cross-contact', observationId: pkg.observations.find(o => o.text === mayContainLine)?.id, text: mayContainLine, matchedLabelTerm: 'milk', matchBasis: 'literal', sourceIds: [] },
    ]);
    expect(result.observationIds).toEqual(result.evidence.map(item => item.observationId));
  });
  it('does not cross unrelated nut species or confuse milk-protein allergy with lactose intolerance', () => {
    const pkg = parseLabel('Ingredients: Almond flour, whey powder, sugar');
    const result = findDeclaredFoodMentions(pkg, { allergies: 'cashew; casein', intolerances: 'lactose' });
    expect(result.map(match => [match.kind, match.term, match.matched])).toEqual([
      ['allergy', 'cashew', false], ['allergy', 'casein', false], ['intolerance', 'lactose', false],
    ]);
    expect(result.every(match => match.observationIds.length === 0 && match.sourceIds.length === 0)).toBe(true);
  });
  it('finds Indian-market label vocabulary through source-linked candidates without turning them into verified facts', () => {
    const pkg = parseLabel('Ingredients: Groundnut oil, soya protein, whey powder, refined wheat flour (maida)');
    const result = findDeclaredFoodMentions(pkg, { allergies: 'peanuts; soy; milk', intolerances: 'gluten' });
    expect(result.map(match => [match.kind, match.term, match.matched, match.matchBasis])).toEqual([
      ['allergy', 'peanuts', true, 'source-backed-alias'],
      ['allergy', 'soy', true, 'source-backed-alias'],
      ['allergy', 'milk', true, 'source-backed-alias'],
      ['intolerance', 'gluten', true, 'source-backed-alias'],
    ]);
    expect(result[0].evidence[0]).toMatchObject({ matchedLabelTerm: 'groundnut oil', matchBasis: 'source-backed-alias' });
    expect(result[1].evidence[0]).toMatchObject({ matchedLabelTerm: 'soya protein', matchBasis: 'source-backed-alias' });
    expect(result[2].evidence[0]).toMatchObject({ matchedLabelTerm: 'whey powder', matchBasis: 'source-backed-alias' });
    expect(result[3].evidence[0]).toMatchObject({ matchedLabelTerm: 'refined wheat flour', matchBasis: 'source-backed-alias' });
    expect(result.flatMap(match => match.sourceIds)).toEqual(expect.arrayContaining([
      'fssai-label-allergens-compendium-2025', 'fssai-whey-casein-milk-products-2022',
    ]));
    expect(result[3].sourceIds).toContain('fssai-atta-maida-nomenclature-2019');
    expect(result.every(match => match.evidence.every(evidence => pkg.observations.some(observation => observation.id === evidence.observationId)))).toBe(true);
  });
  it('keeps the broad tree-nut profile distinct from groundnut/peanut', () => {
    const pkg = parseLabel('Ingredients: Cashew nuts, groundnut oil');
    const result = findDeclaredFoodMentions(pkg, { allergies: 'tree nuts', intolerances: '' })[0];
    expect(result).toMatchObject({ matched: true, matchBasis: 'source-backed-alias' });
    expect(result.evidence.map(item => item.matchedLabelTerm)).toContain('cashew nuts');
    expect(result.evidence.map(item => item.matchedLabelTerm)).not.toContain('groundnut');
  });
  it('keeps declaration categories separate and allows several exact terms', () => {
    const pkg = parseLabel('Ingredients: Wheat flour, peanut oil, salt');
    expect(findDeclaredFoodMentions(pkg, { allergies: 'wheat; peanuts', intolerances: 'gluten' }).map(({kind,term,matched})=>[kind,term,matched])).toEqual([
      ['allergy', 'wheat', true],
      ['allergy', 'peanuts', true],
      ['intolerance', 'gluten', true],
    ]);
  });
  it('checks an explicitly avoided ingredient separately from allergy and intolerance', () => {
    const pkg = parseLabel('Ingredients: Oats, coconut oil, salt');
    const result = findDeclaredFoodMentions(pkg, { allergies: '', intolerances: '', avoidedIngredients: 'coconut' });
    expect(result).toEqual([expect.objectContaining({ kind: 'avoidance', term: 'coconut', matched: true })]);
    expect(result[0].observationIds).toEqual([pkg.observations.find(observation => observation.field === 'ingredients')?.id]);
  });
});
