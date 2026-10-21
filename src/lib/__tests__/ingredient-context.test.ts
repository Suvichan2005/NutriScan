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
      { type: 'ingredient-list', observationId: pkg.observations.find(o => o.text === ingredientLine)?.id, text: ingredientLine },
      { type: 'contains-declaration', observationId: pkg.observations.find(o => o.text === containsLine)?.id, text: containsLine },
      { type: 'precautionary-cross-contact', observationId: pkg.observations.find(o => o.text === mayContainLine)?.id, text: mayContainLine },
    ]);
    expect(result.observationIds).toEqual(result.evidence.map(item => item.observationId));
  });
  it('does not infer synonyms or treat a missing match as safety evidence', () => {
    const pkg = parseLabel('Ingredients: Milk powder, sugar');
    const result = findDeclaredFoodMentions(pkg, { allergies: 'casein', intolerances: 'lactose' });
    expect(result.map(match => [match.kind, match.matched])).toEqual([['allergy', false], ['intolerance', false]]);
    expect(result.every(match => match.observationIds.length === 0)).toBe(true);
  });
  it('keeps declaration categories separate and allows several exact terms', () => {
    const pkg = parseLabel('Ingredients: Wheat flour, peanut oil, salt');
    expect(findDeclaredFoodMentions(pkg, { allergies: 'wheat; peanuts', intolerances: 'gluten' }).map(({kind,term,matched})=>[kind,term,matched])).toEqual([
      ['allergy', 'wheat', true],
      ['allergy', 'peanuts', true],
      ['intolerance', 'gluten', false],
    ]);
  });
});
