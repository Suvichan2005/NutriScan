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
