import { describe, expect, it } from 'vitest';
import { parseLabel } from '../../../lib/parser';
import { buildAudit } from '../../../lib/engine';
import { defaultProfile } from '../../../lib/contracts';
import { applyNutrientCorrection } from '../../../lib/correction';
import { validateNaturalAnswerText } from '../core';

function context(label: string, amount: number, unit: 'g' | 'ml') {
  const pkg = parseLabel(`Synthetic calculation-basis fixture\n${label}`, { origin: 'user' });
  return { package: pkg, calculations: buildAudit(pkg, amount, unit, defaultProfile, '').calculations };
}

describe('native calculation result and portion remain a single supported measurement', () => {
  const oats = context('Nutrition per 100 g\nCarbohydrate 69.2 g', 40, 'g');
  it('retains a rounded calculated result expressed per its actual portion', () => {
    const answer = 'The oats provide 27.7 g carbohydrate per 40 g.';
    expect(validateNaturalAnswerText(answer, oats).answer).toBe(answer);
    expect(validateNaturalAnswerText('The oats provide 27.7 g per 0.04 kg.', oats).withheldUnsupportedQuantitySentenceCount).toBe(0);
  });
  it('transfers to a liquid portion and preserves the concentration basis', () => {
    const drink = context('Nutrition per 100 ml\nProtein 3.2 g', 250, 'ml');
    expect(validateNaturalAnswerText('This provides 8 g protein per 250 ml.', drink).withheldUnsupportedQuantitySentenceCount).toBe(0);
    expect(validateNaturalAnswerText('This provides 8 g protein per 0.25 l.', drink).withheldUnsupportedQuantitySentenceCount).toBe(0);
    for (const answer of ['This provides 8 g protein per 250 g.', 'This provides 8 g protein per 200 ml.', 'This provides 3.2 g protein per 250 ml.']) {
      expect(validateNaturalAnswerText(answer, drink).withheldUnsupportedQuantitySentenceCount).toBe(1);
    }
  });
  it('does not lend a calculated denominator to an input value, wrong result or unsupported portion', () => {
    for (const answer of ['The oats provide 69.2 g carbohydrate per 40 g.', 'The oats provide 28 g carbohydrate per 50 g.', 'The oats provide 27.7 g carbohydrate per 40 ml.', 'The oats provide 27.7 g carbohydrate per 39 g.']) {
      expect(validateNaturalAnswerText(answer, oats).withheldUnsupportedQuantitySentenceCount).toBe(1);
    }
    expect(validateNaturalAnswerText('The oats provide 27.7 g carbohydrate per 40 g.', { ...oats, calculations: [] }).withheldUnsupportedQuantitySentenceCount).toBe(1);
  });
  it('cannot reuse a calculated result or its denominator after a user correction supersedes it', () => {
    const corrected = applyNutrientCorrection(oats.package, { key: 'carbohydrate', value: 75, unit: 'g', basisAmount: 100, basisUnit: 'g' });
    expect(validateNaturalAnswerText('The oats provide 27.7 g carbohydrate per 40 g.', { ...oats, package: corrected }).withheldUnsupportedQuantitySentenceCount).toBe(1);
  });
  it('exposes exact rejected spans and distinguishes quantity from basis failures to an opt-in caller', () => {
    const decisions: Array<{ text: string; reason: string }> = [];
    validateNaturalAnswerText('The oats provide 999 g carbohydrate. The oats provide 69.2 g carbohydrate per 40 g.', { ...oats, onWithheldSentence: decision => decisions.push(decision) });
    expect(decisions).toEqual([
      { text: 'The oats provide 999 g carbohydrate.', reason: 'unsupported-quantity' },
      { text: 'The oats provide 69.2 g carbohydrate per 40 g.', reason: 'unsupported-basis' },
    ]);
  });
});
