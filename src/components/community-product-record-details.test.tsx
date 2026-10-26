import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/lib/contracts';
import { CommunityProductRecordDetails } from './community-product-record-details';

const product: ProductRecord = {
  id: 'off-8901234567890', name: 'Synthetic community record', brand: '', barcode: '8901234567890',
  quantity: '', countries: [], url: 'https://world.openfoodfacts.org/product/8901234567890', retrievedAt: '2026-10-27T00:00:00.000Z',
  lastModified: null, nutrients: [], ingredients: 'Example ingredient list', allergens: ['en:milk'], allergenTraces: ['en:soy'],
  match: 'barcode', availability: 'local stock unverified',
};

describe('community product record allergen fields', () => {
  it('renders declaration tags and precautionary trace tags separately with absence caveats', () => {
    const html = renderToStaticMarkup(createElement(CommunityProductRecordDetails, { product }));

    expect(html).toContain('Allergen tags listed in the record');
    expect(html).toContain('Milk');
    expect(html).toContain('Precautionary trace tags listed in the record');
    expect(html).toContain('Soy');
    expect(html).not.toContain('<li>Milk</li><li>Soy</li>');
  });

  it('does not describe a missing community trace tag as evidence of no cross-contact', () => {
    const html = renderToStaticMarkup(createElement(CommunityProductRecordDetails, { product: { ...product, allergenTraces: [] } }));

    expect(html).toContain('No allergen trace tags are listed. This does not confirm cross-contact absence.');
  });
});
