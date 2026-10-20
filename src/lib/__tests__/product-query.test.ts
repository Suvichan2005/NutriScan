import { describe, expect, it } from 'vitest';
import { buildProductLookupRequest } from '../product-query';

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
});
