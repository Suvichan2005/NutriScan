import type { PackageData } from './contracts';

export type ProductLookupOptions = {
  text: string;
  alternatives?: boolean;
  country?: string;
  productName?: string;
  productBarcode?: string;
};

/** Avoid preselecting a catalog search while the package identity is disputed. */
export function defaultProductLookup(data: Pick<PackageData, 'barcode' | 'identityConflict' | 'name' | 'userDescription'>): string {
  if (data.identityConflict) return '';
  return data.barcode ?? (data.name === 'Unidentified package' ? (data.userDescription ?? '') : data.name);
}

/** Build a bounded catalog request without inferring location or losing an exact current identifier. */
export function buildProductLookupRequest(options: ProductLookupOptions) {
  const text = options.text.trim();
  if (!options.alternatives && /^\d{8,14}$/.test(text)) return { barcode: text };
  const query = options.alternatives && options.productBarcode && text === options.productBarcode && options.productName && options.productName !== 'Unidentified package'
    ? options.productName
    : text;
  return {
    query,
    alternatives: options.alternatives ?? false,
    ...(options.alternatives && options.country?.trim() ? { country: options.country.trim() } : {}),
    ...(options.alternatives && options.productBarcode ? { excludeBarcode: options.productBarcode } : {}),
  };
}
