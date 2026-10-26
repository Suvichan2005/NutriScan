import type { PackageData } from './contracts';
import { findOcrGtinCandidate } from './barcode';

export type ProductLookupOptions = {
  text: string;
  alternatives?: boolean;
  country?: string;
  productName?: string;
  productBarcode?: string;
};

export type ProductQuerySource = 'barcode' | 'barcode-candidate' | 'label-text' | 'user-detail';

function hasConflictingNameEvidence(name: string, observations: NonNullable<PackageData['observations']>) {
  return observations.some(observation => observation.text.trim() === name
    && observation.field !== 'name' && observation.field !== 'productName');
}

/** Describe the provenance of the exact term used by the explicit catalog action. */
export function productQuerySource(data: Pick<PackageData, 'barcode' | 'identityConflict' | 'name' | 'userDescription' | 'observations'>): ProductQuerySource {
  if (data.barcode) return 'barcode';
  if (data.userDescription?.trim() && (data.name === 'Unidentified package' || hasConflictingNameEvidence(data.name, data.observations))) return 'user-detail';
  if (data.name === 'Unidentified package' && data.userDescription?.trim()) return 'user-detail';
  if (hasConflictingNameEvidence(data.name, data.observations)) return 'label-text';
  if (data.observations.some(observation => observation.field === 'name' && observation.origin === 'user' && observation.text.trim() === data.name)) return 'user-detail';
  if (!data.identityConflict && findOcrGtinCandidate(data.observations)) return 'barcode-candidate';
  return 'label-text';
}

/** Avoid preselecting a catalog search while the package identity is disputed. */
export function defaultProductLookup(data: Pick<PackageData, 'barcode' | 'identityConflict' | 'name' | 'userDescription'> & { observations?: PackageData['observations'] }): string {
  if (data.identityConflict) return '';
  if (data.barcode) return data.barcode;
  const conflictingNameEvidence = hasConflictingNameEvidence(data.name, data.observations ?? []);
  if (conflictingNameEvidence) return data.userDescription?.trim() || findOcrGtinCandidate(data.observations ?? [])?.code || '';
  if (data.name === 'Unidentified package' && data.userDescription?.trim()) return data.userDescription;
  return findOcrGtinCandidate(data.observations ?? [])?.code ?? data.name;
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

/** Distinguish a search-field match from evidence that a record is the same package. */
export function productIdentityDisclosure(packageBarcode: string | undefined, recordBarcode: string, lookupMatch: 'barcode' | 'candidate') {
  const lookup = lookupMatch === 'barcode' ? 'The record exactly matches the barcode entered in search.' : 'The record was returned as a text-search candidate.';
  const packageIdentity = packageBarcode
    ? packageBarcode === recordBarcode
      ? 'The recorded package barcode agrees with this record; confirm regional formulation, variant, and label date.'
      : 'The recorded package barcode differs from this record; treat the comparison as a candidate or alternative only.'
    : 'No package barcode was established, so exact package identity remains unverified.';
  return `${lookup} ${packageIdentity}`;
}
