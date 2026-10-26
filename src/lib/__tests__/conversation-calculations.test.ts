import { describe, expect, it } from 'vitest';
import { conversationCalculationsForAssist } from '../conversation-context';
import { parseLabel } from '../parser';
import { buildAudit } from '../engine';
import { defaultProfile, packageSchema, type Calculation, type SavedConversationTurn } from '../contracts';
import { applyNutrientCorrection } from '../correction';
import { assistInput } from '../server/gemini';

const pkg = parseLabel('Synthetic continuity fixture\nNutrition per 100 g\nCarbohydrate 69.2 g\nProtein 8 g', { origin: 'user' });
const operations = (amount: number) => buildAudit(pkg, amount, 'g', defaultProfile, '').calculations;
const turn = (calculations?: Calculation[]): SavedConversationTurn => ({ question: 'Earlier portion question', answer: 'Earlier prose, including an unsupported 999 mg.', at: '2026-10-26T00:00:00.000Z', ...(calculations ? { calculations } : {}) });

describe('bounded typed prior operations for Gemini follow-ups', () => {
  it('carries validated prior quantities, not numbers from prior answer text', () => {
    expect(conversationCalculationsForAssist([turn()], pkg)).toEqual([]);
    const calculations = conversationCalculationsForAssist([turn(operations(40))], pkg);
    expect(calculations).toHaveLength(2);
    expect(calculations.find(row => row.nutrient === 'carbohydrate')).toMatchObject({ input: 69.2, portion: 40, result: 27.68 });
    expect(assistInput.safeParse({ consent: true, question: 'Compare 30 g with the earlier amount.', package: pkg, calculations }).success).toBe(true);
  });
  it('preserves different portions even when legacy local IDs collide and deduplicates repeated operations', () => {
    const calculations = conversationCalculationsForAssist([turn(operations(40)), turn(operations(30)), turn(operations(40))], pkg);
    expect(calculations).toHaveLength(4);
    expect(new Set(calculations.map(row => row.id)).size).toBe(4);
    expect(new Set(calculations.map(row => row.portion))).toEqual(new Set([30, 40]));
  });
  it('transfers to volume-based package readings without converting mass and volume', () => {
    const drink = parseLabel('Synthetic drink\nNutrition per 100 ml\nProtein 3.2 g', { origin: 'user' });
    const calculations = conversationCalculationsForAssist([turn(buildAudit(drink, 250, 'ml', defaultProfile, '').calculations)], drink);
    expect(calculations).toContainEqual(expect.objectContaining({ portion: 250, portionUnit: 'ml', result: 8, unit: 'g' }));
    expect(conversationCalculationsForAssist([turn(calculations.map(row => ({ ...row, portionUnit: 'g' })))], drink)).toEqual([]);
  });
  it('rejects outdated, tampered, unlinked and no-longer-current package operations', () => {
    const prior = operations(40);
    expect(conversationCalculationsForAssist([{ ...turn(prior), outdated: true }], pkg)).toEqual([]);
    expect(conversationCalculationsForAssist([turn(prior.map(row => ({ ...row, result: 999 })))], pkg)).toEqual([]);
    expect(conversationCalculationsForAssist([turn(prior.map(row => ({ ...row, observationIds: ['missing'] })))], pkg)).toEqual([]);
    const changed = packageSchema.parse({ ...pkg, nutrients: pkg.nutrients.map(row => ({ ...row, value: row.value + 1 })) });
    expect(conversationCalculationsForAssist([turn(prior)], changed)).toEqual([]);
    const corrected = applyNutrientCorrection(pkg, { key: 'carbohydrate', value: 75, unit: 'g', basisAmount: 100, basisUnit: 'g' });
    expect(conversationCalculationsForAssist([turn(prior)], corrected).some(row => row.nutrient === 'carbohydrate')).toBe(false);
  });
  it('limits history to the same four recent turns and at most twenty operations', () => {
    const history = [turn(operations(40)), turn(), turn(), turn(), turn()];
    expect(conversationCalculationsForAssist(history, pkg)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, index) => operations(index + 1)[0]);
    expect(conversationCalculationsForAssist([turn(many)], pkg)).toHaveLength(20);
  });
});
