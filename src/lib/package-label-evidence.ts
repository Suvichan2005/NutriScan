import type { Observation, PackageData } from './contracts';

export type PackageLabelEvidenceGroup = {
  field: 'ingredients' | 'allergens' | 'claim';
  label: string;
  observations: Observation[];
};

const labelGroups = [
  { field: 'ingredients', label: 'Text grouped as ingredients' },
  { field: 'allergens', label: 'Possible allergen statements' },
  { field: 'claim', label: 'Text grouped as package claims' },
] as const;

export function packageLabelEvidenceGroups(pkg: Pick<PackageData, 'observations'>): PackageLabelEvidenceGroup[] {
  return labelGroups.flatMap(({ field, label }) => {
    const observations = pkg.observations.filter(observation => observation.field === field);
    return observations.length ? [{ field, label, observations }] : [];
  });
}

export function otherPackageOcrLines(
  pkg: Pick<PackageData, 'observations'>,
  groups: PackageLabelEvidenceGroup[] = packageLabelEvidenceGroups(pkg),
): Observation[] {
  const represented = new Set(groups.flatMap(group => group.observations.flatMap(observation => observation.derivedFromObservationIds ?? [])));
  return pkg.observations.filter(observation =>
    observation.origin === 'ocr' && observation.field === 'ocr-line' && !represented.has(observation.id),
  );
}

/**
 * Short OCR fragments and isolated numbers are not usable package statements
 * without context. Keep them in the original observations and transcript, but
 * tuck them away in the consumer-facing label view.
 */
export function isLowSignalPackageOcrLine(observation: Pick<Observation, 'text'>): boolean {
  const text = observation.text.normalize('NFKC').trim();
  if (!text) return true;
  const compact = text.replace(/\s+/gu, '');
  // A number attached to a unit can be useful; an isolated number has no
  // reliable row, quantity or serving basis until other evidence links it.
  if (/^\p{N}+(?:[.,]\p{N}+)?$/u.test(compact)) return true;
  if (/\p{N}/u.test(compact)) return false;
  const words = text.match(/\p{L}+/gu) ?? [];
  // Two- and three-letter OCR scraps are commonly glyph noise; the complete
  // observations remain available in the raw transcript and explicit expand.
  return words.length === 0 || !words.some(word => word.length >= 4);
}
