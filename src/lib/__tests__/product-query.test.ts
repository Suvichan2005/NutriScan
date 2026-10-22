import { describe, expect, it } from 'vitest';
import { buildProductLookupRequest, defaultProductLookup, productIdentityDisclosure, productQuerySource } from '../product-query';

describe('product catalog request construction', () => {
  it('keeps exact barcode lookup separate from candidate search', () => {
    expect(buildProductLookupRequest({ text: ' 3017620422003 ' })).toEqual({ barcode: '3017620422003' });
  });
  it('does not infer country for candidates and excludes the current product', () => {
    expect(buildProductLookupRequest({ text: '3017620422003', alternatives: true, productBarcode: '3017620422003', productName: 'Example Wafer' })).toEqual({ query: 'Example Wafer', alternatives: true, excludeBarcode: '3017620422003' });
  });
  it('uses a country only when the user actually supplied one', () => {
    expect(buildProductLookupRequest({ text: 'oats', alternatives: true, country: ' India ' })).toEqual({ query: 'oats', alternatives: true, country: 'India' });
    expect(buildProductLookupRequest({ text: 'oats', alternatives: true, country: '   ' })).toEqual({ query: 'oats', alternatives: true });
  });
  it('does not replace an unresolved package name with an identifier', () => {
    expect(buildProductLookupRequest({ text: '3017620422003', alternatives: true, productBarcode: '3017620422003', productName: 'Unidentified package' })).toMatchObject({ query: '3017620422003', alternatives: true });
  });
  it('leaves catalog search blank when merged package identity is disputed', () => {
    expect(defaultProductLookup({ barcode: undefined, identityConflict: true, name: 'Original product', userDescription: undefined })).toBe('');
  });
  it('offers one checksum-valid raw OCR code as an explicit lookup candidate without promoting it to package identity', () => {
    const observations = [{ id: 'ocr-back-1', field: 'ocr-line', text: 'OTHER 8901928202755>', side: 'back' as const, confidence: 81, origin: 'ocr' as const, imageId: 'photo-back' }];
    const data = { barcode: undefined, identityConflict: false, name: 'PROTEN TOTALFAT', userDescription: undefined, observations };
    expect(defaultProductLookup(data)).toBe('8901928202755');
    expect(productQuerySource(data)).toBe('barcode-candidate');
    expect(buildProductLookupRequest({ text: defaultProductLookup(data) })).toEqual({ barcode: '8901928202755' });
    expect(data.barcode).toBeUndefined();
  });
  it('does not offer OCR barcode candidates when evidence conflicts or the check digit is invalid', () => {
    const observation = { id: 'ocr-line', field: 'ocr-line', text: '4006381333932', side: 'back' as const, confidence: 81, origin: 'ocr' as const, imageId: 'photo-back' };
    expect(defaultProductLookup({ barcode: undefined, identityConflict: true, name: 'Example', userDescription: undefined, observations: [observation] })).toBe('');
    expect(defaultProductLookup({ barcode: undefined, identityConflict: false, name: 'Unidentified package', userDescription: undefined, observations: [observation] })).toBe('Unidentified package');
    expect(productQuerySource({ barcode: undefined, identityConflict: false, name: 'Unidentified package', userDescription: undefined, observations: [observation] })).toBe('label-text');
  });
  it('reports user-entered identity text separately from OCR-recognized package text', () => {
    const observation = (origin: 'user' | 'ocr') => ({ id: `${origin}-name`, field: 'name', text: 'Saffola Masala Oats', side: 'text' as const, confidence: null, origin });
    const base = { barcode: undefined, identityConflict: false, name: 'Saffola Masala Oats', userDescription: 'Saffola Masala Oats' };
    expect(productQuerySource({ ...base, observations: [observation('user')] })).toBe('user-detail');
    expect(productQuerySource({ ...base, observations: [observation('ocr')] })).toBe('label-text');
    expect(productQuerySource({ ...base, barcode: '8901088068758', observations: [observation('user')] })).toBe('barcode');
  });
  it('does not confuse an exact search barcode with verified package identity', () => {
    expect(productIdentityDisclosure(undefined, '8902710100150', 'barcode')).toMatch(/exactly matches the barcode entered in search.*No package barcode was established.*unverified/i);
    expect(productIdentityDisclosure('12345678', '8902710100150', 'candidate')).toMatch(/text-search candidate.*barcode differs.*candidate or alternative only/i);
    expect(productIdentityDisclosure('8902710100150', '8902710100150', 'barcode')).toMatch(/package barcode agrees.*confirm regional formulation/i);
  });
});
