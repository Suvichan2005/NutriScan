import { packageSchema, type Nutrient, type NutrientKey, type PackageData } from './contracts';

/** Returns package evidence that a user correction explicitly replaces. */
export function correctionEvidenceIds(pkg: PackageData, key: NutrientKey): string[] {
  const referencedIds = new Set<string>();
  for (const nutrient of pkg.nutrients) {
    if (nutrient.key === key) nutrient.observationIds.forEach(id => referencedIds.add(id));
  }
  for (const diagnostic of pkg.parserDiagnostics ?? []) {
    if (diagnostic.field !== key) continue;
    diagnostic.sourceObservationIds.forEach(id => referencedIds.add(id));
    diagnostic.numericEvidenceObservationIds?.forEach(id => referencedIds.add(id));
    diagnostic.basisEvidenceObservationIds?.forEach(id => referencedIds.add(id));
  }

  // Preserve package reading order. The package and observation contracts bound the list.
  return pkg.observations.filter(observation => referencedIds.has(observation.id)).map(observation => observation.id);
}

export type NutrientCorrection = {
  key: NutrientKey;
  value: number;
  unit: Nutrient['unit'];
  basisAmount: number;
  basisUnit: 'g' | 'ml';
  productName?: string;
  sourceObservationIds?: string[];
};

/** Applies a user-confirmed correction while retaining and linking prior evidence. */
export function applyNutrientCorrection(pkg: PackageData, correction: NutrientCorrection): PackageData {
  const allowedUnits = correction.key === 'energy'
    ? ['kcal', 'kJ']
    : correction.key === 'sodium' || correction.key === 'salt'
      ? ['g', 'mg']
      : ['g'];
  if (!allowedUnits.includes(correction.unit)) throw new Error('The correction unit does not match the selected nutrient.');
  if (!Number.isFinite(correction.value) || correction.value < 0 || correction.value > 100000
    || !Number.isFinite(correction.basisAmount) || correction.basisAmount <= 0 || correction.basisAmount > 10000) {
    throw new Error('The correction value or printed basis is outside supported ranges.');
  }
  const sourceObservationIds = [...new Set(correction.sourceObservationIds ?? [])];
  if (sourceObservationIds.length > 20 || sourceObservationIds.some(id => !pkg.observations.some(observation => observation.id === id))) {
    throw new Error('A correction must link to existing package evidence.');
  }
  const id = crypto.randomUUID();
  const productName = correction.productName?.trim();
  const observation = {
    id,
    field: correction.key,
    text: `User correction: ${correction.value} ${correction.unit} per ${correction.basisAmount} ${correction.basisUnit}${productName ? `; product name supplied by user: ${productName}` : ''}`,
    side: 'text' as const,
    confidence: null,
    origin: 'user' as const,
    supersedesObservationIds: correctionEvidenceIds(pkg, correction.key),
    ...(sourceObservationIds.length ? { derivedFromObservationIds: sourceObservationIds } : {}),
    value: correction.value,
    unit: correction.unit,
  };
  return packageSchema.parse({
    ...pkg,
    warnings: pkg.warnings.filter(warning => !warning.startsWith(`${correction.key}:`) && !warning.startsWith('No usable nutrition values')),
    name: productName || pkg.name,
    nutrients: [
      ...pkg.nutrients.filter(nutrient => nutrient.key !== correction.key),
      {
        key: correction.key,
        value: correction.value,
        unit: correction.unit,
        basis: { amount: correction.basisAmount, unit: correction.basisUnit, description: 'User-corrected label basis' },
        observationIds: [id],
        status: 'corrected' as const,
      },
    ],
    observations: [...pkg.observations, observation],
  });
}
