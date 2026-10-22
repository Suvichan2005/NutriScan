import { describe, expect, it } from 'vitest';
import { productEvidenceSource } from '../product-evidence';
import type { ProductRecord } from '../contracts';

const product: ProductRecord = {
  id: '123456789', name: 'Example Oats', brand: 'Example', barcode: '123456789', quantity: '500 g', countries: ['India'],
  url: 'https://world.openfoodfacts.org/product/123456789', retrievedAt: '2026-10-22T00:00:00.000Z', lastModified: null,
  nutrients: [{ key: 'protein', value: 13, unit: 'g', basis: { amount: 100, unit: 'g' } }],
  ingredients: 'Oats', allergens: [], match: 'barcode', availability: 'local stock unverified',
};

describe('explicitly selected product evidence for assist', () => {
  it('keeps the community record attributed and bounded as a candidate source', () => {
    const source = productEvidenceSource(product, '2026-10-22T12:00:00.000Z');
    expect(source).toMatchObject({
      id: 'community-product-123456789', publisher: 'Open Food Facts community database', category: 'product',
      summary: expect.stringContaining('protein: 13 g per 100 g'),
      limitations: expect.stringContaining('not manufacturer verification'),
      retrievedAt: '2026-10-22T12:00:00.000Z',
    });
  });

  it('does not accept an unsafe community-record link as evidence', () => {
    expect(productEvidenceSource({ ...product, url: 'javascript:alert(1)' })).toBeNull();
    expect(productEvidenceSource({ ...product, url: 'http://example.org/product' })).toBeNull();
  });
});
