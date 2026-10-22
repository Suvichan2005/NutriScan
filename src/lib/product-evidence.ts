import { sourceSchema, type EvidenceSource, type ProductRecord } from './contracts';
import { isSafeEvidenceUrl } from './followup-evidence';

/** Convert an explicitly selected community record into bounded, attributed assist evidence. */
export function productEvidenceSource(product: ProductRecord, retrievedAt = new Date().toISOString()): EvidenceSource | null {
  if (!isSafeEvidenceUrl(product.url)) return null;
  const nutrients = product.nutrients.map(item =>
    `${item.key}: ${item.value} ${item.unit}${item.basis ? ` per ${item.basis.amount} ${item.basis.unit}` : ' (basis not reported)'}`,
  );
  const details = [
    `Record type: ${product.match === 'barcode' ? 'barcode match candidate' : 'possible product match'}`,
    `Name: ${product.name}`,
    product.brand ? `Brand: ${product.brand}` : '',
    product.quantity ? `Pack quantity: ${product.quantity}` : '',
    product.barcode ? `Barcode: ${product.barcode}` : '',
    ...nutrients,
    product.ingredients ? `Ingredients: ${product.ingredients}` : '',
    product.allergens.length ? `Allergens recorded: ${product.allergens.join(', ')}` : '',
  ].filter(Boolean).join('; ').slice(0, 1500);
  const safeId = `community-product-${product.id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 160);
  const parsed = sourceSchema.safeParse({
    id: safeId,
    title: product.name.slice(0, 300) || 'Community product record',
    publisher: 'Open Food Facts community database',
    url: product.url,
    category: 'product',
    jurisdiction: product.countries.join(', ') || 'Not established',
    publishedAt: product.lastModified,
    effectiveAt: null,
    retrievedAt,
    summary: details,
    limitations: 'Community-maintained product data, not manufacturer verification. The formulation or variant may differ; confirm the package. Local stock is not established.',
    license: 'Open Database License (ODbL) 1.0',
  });
  return parsed.success ? parsed.data : null;
}
