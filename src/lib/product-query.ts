import type { PackageData } from './contracts';
import { findOcrGtinCandidate } from './barcode';

export type ProductLookupOptions = {
  text: string;
  alternatives?: boolean;
  country?: string;
  productName?: string;
  productBarcode?: string;
};

export type ProductQuerySource = 'barcode' | 'barcode-candidate' | 'label-text' | 'user-detail' | 'reconstruction';

type LookupPackage = Pick<PackageData, 'barcode' | 'identityConflict' | 'name' | 'userDescription'> & { observations?: PackageData['observations']; reconstruction?: PackageData['reconstruction'] };
function reconstructedIdentity(data: LookupPackage): string {
  const reconstruction = data.reconstruction;
  const identity = reconstruction?.current ? reconstruction.identity : null;
  if (!identity || !['clear', 'provisional'].includes(identity.status) || (!identity.evidence.observationIds.length && !identity.evidence.imageRegions.length)) return '';
  const parts = [identity.brand, identity.name, identity.variant].map(value => value?.trim() ?? '').filter(value => value && !/^(unknown|unidentified|unreadable|not specified|n\/?a)$/i.test(value));
  return [...new Set(parts)].join(' ').slice(0, 200);
}

/** Automatic lookups use only a decoded barcode or the current linked reconstruction. */
export function automaticProductLookup(data: LookupPackage): string {
  if (data.identityConflict || !data.reconstruction?.current) return '';
  return data.barcode || reconstructedIdentity(data);
}

function hasConflictingNameEvidence(name: string, observations: NonNullable<PackageData['observations']>) {
  return observations.some(observation => observation.text.trim() === name
    && observation.field !== 'name' && observation.field !== 'productName');
}

/** Describe the provenance of the exact term used by the explicit catalog action. */
export function productQuerySource(data: LookupPackage): ProductQuerySource {
  const observations = data.observations ?? [];
  if (data.barcode) return 'barcode';
  if (data.userDescription?.trim() && (data.name === 'Unidentified package' || hasConflictingNameEvidence(data.name, observations))) return 'user-detail';
  if (data.name === 'Unidentified package' && data.userDescription?.trim()) return 'user-detail';
  if (hasConflictingNameEvidence(data.name, observations)) return 'label-text';
  if (observations.some(observation => observation.field === 'name' && observation.origin === 'user' && observation.text.trim() === data.name)) return 'user-detail';
  if (!data.identityConflict && findOcrGtinCandidate(observations)) return 'barcode-candidate';
  if (!data.identityConflict && reconstructedIdentity(data)) return 'reconstruction';
  return 'label-text';
}

/** Avoid preselecting a catalog search while the package identity is disputed. */
export function defaultProductLookup(data: LookupPackage): string {
  if (data.identityConflict) return '';
  if (data.barcode) return data.barcode;
  const conflictingNameEvidence = hasConflictingNameEvidence(data.name, data.observations ?? []);
  if (conflictingNameEvidence) return data.userDescription?.trim() || findOcrGtinCandidate(data.observations ?? [])?.code || '';
  if (data.name === 'Unidentified package' && data.userDescription?.trim()) return data.userDescription;
  if ((data.observations ?? []).some(observation => observation.field === 'name' && observation.origin === 'user' && observation.text.trim() === data.name)) return data.name;
  return findOcrGtinCandidate(data.observations ?? [])?.code ?? (reconstructedIdentity(data) || (data.name === 'Unidentified package' ? '' : data.name));
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
