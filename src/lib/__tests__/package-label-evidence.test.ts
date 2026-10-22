import { describe, expect, it } from 'vitest';
import { otherPackageOcrLines, packageLabelEvidenceGroups } from '../package-label-evidence';
import type { Observation } from '../contracts';

function line(id: string, text: string, lineIndex: number): Observation {
  return {
    id,
    field: 'ocr-line',
    text,
    side: 'back',
    confidence: 74,
    origin: 'ocr',
    imageId: 'back-photo',
    readingOrder: { runId: 'ocr-run', blockIndex: 0, paragraphIndex: 0, lineIndex },
    bbox: { x0: 10, y0: lineIndex * 20, x1: 200, y1: lineIndex * 20 + 15 },
  };
}

describe('package label evidence groups', () => {
  it('keeps every ingredient, allergen and claim observation with its raw OCR source available', () => {
    const ingredientLine = line('raw-ingredients', 'Ingredients: Wheat flour, vegetable oil', 0);
    const allergenLine = line('raw-allergen', 'Contains wheat', 1);
    const claimLine = line('raw-claim', 'No added sugar', 2);
    const otherLine = line('raw-other', 'FSSAI 12345678901234', 3);
    const observations: Observation[] = [
      ingredientLine,
      { ...ingredientLine, id: 'ingredient-observation', field: 'ingredients', derivedFromObservationIds: [ingredientLine.id] },
      allergenLine,
      { ...allergenLine, id: 'allergen-observation', field: 'allergens', derivedFromObservationIds: [allergenLine.id] },
      claimLine,
      { ...claimLine, id: 'claim-observation', field: 'claim', derivedFromObservationIds: [claimLine.id] },
      otherLine,
    ];
    const pkg = { observations };

    const groups = packageLabelEvidenceGroups(pkg);

    expect(groups.map(group => [group.field, group.label, group.observations.map(observation => observation.text)])).toEqual([
      ['ingredients', 'Text grouped as ingredients', ['Ingredients: Wheat flour, vegetable oil']],
      ['allergens', 'Possible allergen statements', ['Contains wheat']],
      ['claim', 'Text grouped as package claims', ['No added sugar']],
    ]);
    expect(otherPackageOcrLines(pkg, groups).map(observation => observation.id)).toEqual(['raw-other']);
  });

  it('does not discard ungrouped OCR when the parser did not classify a label line', () => {
    const rawIngredients = line('raw-unparsed', 'Ingredients: Oats, salt', 0);
    const pkg = { observations: [rawIngredients] };

    expect(packageLabelEvidenceGroups(pkg)).toEqual([]);
    expect(otherPackageOcrLines(pkg).map(observation => observation.text)).toEqual(['Ingredients: Oats, salt']);
  });
});
