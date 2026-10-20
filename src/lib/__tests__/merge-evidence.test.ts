import { describe, expect, it } from 'vitest';
import { mergePackageEvidence } from '../merge-evidence';
import { parseLabel } from '../parser';

describe('incremental package evidence', () => {
  it('preserves the investigation identity and prior readings while appending new evidence', () => {
    const first = parseLabel('Brand: North Mill\nNutrition per 100 g\nProtein 12 g\nIngredients: Oats, salt', { origin: 'ocr' });
    const second = parseLabel('Nutrition per 100 g\nFibre 5 g\nContains: sesame', { origin: 'ocr' });
    const merged = mergePackageEvidence(first, second);
    expect(merged.id).toBe(first.id);
    expect(merged.createdAt).toBe(first.createdAt);
    expect(merged.brand).toBe('North Mill');
    expect(merged.nutrients.map(n => n.key)).toEqual(['protein', 'fiber']);
    expect(merged.ingredients).toContain('Oats, salt');
    expect(merged.allergens).toContain('Contains: sesame');
    expect(merged.rawText).toContain('Additional photo evidence');
    expect(merged.observations.length).toBeGreaterThan(first.observations.length);
  });

  it('keeps conflicting comparable readings and marks both for review', () => {
    const first = parseLabel('Nutrition per 100 g\nSodium 850 mg', { origin: 'ocr' });
    const second = parseLabel('Nutrition per 100 g\nSodium 85 mg', { origin: 'ocr' });
    const merged = mergePackageEvidence(first, second);
    expect(merged.nutrients).toHaveLength(2);
    expect(merged.nutrients.every(n => n.status === 'conflict')).toBe(true);
    expect(merged.warnings.join(' ')).toMatch(/conflict/i);
  });

  it('does not merge different mass and volume bases into a conflict', () => {
    const first = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr' });
    const second = parseLabel('Nutrition per 100 ml\nProtein 12 g', { origin: 'ocr' });
    expect(mergePackageEvidence(first, second).nutrients.every(n => n.status === 'observed')).toBe(true);
  });

  it('retains the original barcode and warns when later evidence identifies another product', () => {
    const first = parseLabel('Brand: A\nBarcode: 12345678\nNutrition per 100 g\nProtein 1 g', { origin: 'ocr' });
    const second = parseLabel('Brand: B\nBarcode: 87654321\nNutrition per 100 g\nProtein 2 g', { origin: 'ocr' });
    const merged = mergePackageEvidence(first, second);
    expect(merged.barcode).toBe('12345678');
    expect(merged.warnings.join(' ')).toMatch(/barcode differs/i);
  });

  it('deduplicates repeated observations from the same image and preserves nutrient links', () => {
    const first = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr', observations: [
      { id: 'img-a-line', field: 'ocr-line', text: 'Protein 12 g', side: 'back', origin: 'ocr', confidence: 90, imageId: 'photo-a' },
    ] });
    const second = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr', observations: [
      { id: 'img-a-line-2', field: 'ocr-line', text: 'Protein 12 g', side: 'back', origin: 'ocr', confidence: 90, imageId: 'photo-a' },
    ] });
    const merged = mergePackageEvidence(first, second);
    expect(merged.observations.filter(o => o.imageId === 'photo-a' && o.field === 'ocr-line')).toHaveLength(1);
    expect(merged.nutrients).toHaveLength(1);
    expect(merged.nutrients[0].observationIds.every(id => merged.observations.some(o => o.id === id))).toBe(true);
  });
});
