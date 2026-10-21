import { describe, expect, it } from 'vitest';
import { mergePackageEvidence } from '../merge-evidence';
import { defaultProductLookup } from '../product-query';
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

  it('withholds the catalog identity and warns when later evidence has another barcode', () => {
    const first = parseLabel('Brand: A\nBarcode: 12345678\nNutrition per 100 g\nProtein 1 g', { origin: 'ocr' });
    const second = parseLabel('Brand: A\nBarcode: 87654321\nNutrition per 100 g\nProtein 2 g', { origin: 'ocr' });
    const merged = mergePackageEvidence(first, second);
    expect(merged.barcode).toBeUndefined();
    expect(merged.identityConflict).toBe(true);
    expect(defaultProductLookup(merged)).toBe('');
    expect(merged.warnings.join(' ')).toMatch(/barcode differs/i);
  });

  it('warns when package brand or license evidence conflicts without barcodes', () => {
    const first = parseLabel('Brand: North Mill\nFSSAI License No: 12345678901234\nNutrition per 100 g\nProtein 1 g', { origin: 'ocr' });
    const second = parseLabel('Brand: South Mill\nFSSAI License No: 43210987654321\nNutrition per 100 g\nProtein 1 g', { origin: 'ocr' });
    const merged = mergePackageEvidence(first, second);
    expect(merged.brand).toBe('North Mill');
    expect(merged.license).toBe('12345678901234');
    expect(merged.identityConflict).toBe(true);
    expect(defaultProductLookup(merged)).toBe('');
    expect(merged.warnings.join(' ')).toMatch(/brand and license number/i);
  });

  it('labels pasted evidence separately from OCR in the accumulated text record', () => {
    const first = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr' });
    const entered = parseLabel('Nutrition per 100 g\nFibre 5 g', { origin: 'user' });
    expect(mergePackageEvidence(first, entered).rawText).toContain('Additional user-entered label text');
  });

  it('preserves and deduplicates user descriptions across later photo reads', () => {
    const first = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'user', userDescription: 'Oat snack' });
    const second = parseLabel('Nutrition per 100 g\nFibre 5 g', { origin: 'ocr', userDescription: 'Oat snack' });
    const merged = mergePackageEvidence(first, second);
    expect(merged.userDescription).toBe('Oat snack');
    expect(merged.observations.filter(o => o.field === 'user-description')).toHaveLength(1);
  });

  it('deduplicates repeated observations from the same image and preserves nutrient links', () => {
    const first = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr', observations: [
      { id: 'img-a-header', field: 'ocr-line', text: 'Nutrition per 100 g', side: 'back', origin: 'ocr', confidence: 90, imageId: 'photo-a' },
      { id: 'img-a-line', field: 'ocr-line', text: 'Protein 12 g', side: 'back', origin: 'ocr', confidence: 90, imageId: 'photo-a' },
    ] });
    const second = parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr', observations: [
      { id: 'img-a-header-2', field: 'ocr-line', text: 'Nutrition per 100 g', side: 'back', origin: 'ocr', confidence: 90, imageId: 'photo-a' },
      { id: 'img-a-line-2', field: 'ocr-line', text: 'Protein 12 g', side: 'back', origin: 'ocr', confidence: 90, imageId: 'photo-a' },
    ] });
    const merged = mergePackageEvidence(first, second);
    expect(merged.observations.filter(o => o.imageId === 'photo-a' && o.field === 'ocr-line')).toHaveLength(2);
    expect(merged.nutrients).toHaveLength(1);
    expect(merged.nutrients[0].observationIds.every(id => merged.observations.some(o => o.id === id))).toBe(true);
    const diagnostic=merged.parserDiagnostics?.find(item=>item.field==='protein');
    expect(diagnostic?.numericEvidenceObservationIds).toEqual(['img-a-line']);
    expect(diagnostic?.basisEvidenceObservationIds).toEqual(['img-a-header']);
  });

  it('keeps both image sources when identical nutrient readings are merged', () => {
    const read = (imageId: string) => parseLabel('Nutrition per 100 g\nProtein 12 g', { origin: 'ocr', observations: [
      { id: `${imageId}-header`, field: 'ocr-line', text: 'Nutrition per 100 g', side: 'back', origin: 'ocr', confidence: 90, imageId },
      { id: `${imageId}-protein`, field: 'ocr-line', text: 'Protein 12 g', side: 'back', origin: 'ocr', confidence: 90, imageId },
    ] });
    const merged = mergePackageEvidence(read('photo-a'), read('photo-b'));
    expect(merged.nutrients).toHaveLength(1);
    const sources = merged.nutrients[0].observationIds.map(id => merged.observations.find(o => o.id === id)?.imageId).filter(Boolean);
    expect(new Set(sources)).toEqual(new Set(['photo-a', 'photo-b']));
  });
});
