import { nutrientKeys, type Nutrient, type NutrientKey, type ProductRecord } from './contracts';
import { matchesPackageRows, type InterpretedNutrientReading } from './interpreted-nutrients';

export type ProductComparisonStatus = 'comparable' | 'package-identity-conflict' | 'package-reading-missing' | 'record-reading-missing' | 'package-reading-conflict' | 'package-basis-unknown' | 'record-basis-unknown' | 'basis-type-mismatch' | 'unit-mismatch';
export type ProductComparisonRow = {
  key: NutrientKey;
  status: ProductComparisonStatus;
  unit: 'kcal' | 'g' | 'mg' | null;
  basisUnit: 'g' | 'ml' | null;
  packageReading: PackageComparisonReading | null;
  packageReadingSource: 'package-observation' | 'gemini-interpretation' | null;
  recordReading: ProductRecord['nutrients'][number] | null;
  packagePer100: number | null;
  recordPer100: number | null;
  difference: number | null;
};

/** Ephemeral comparison input; interpreted readings are never written into PackageData. */
export type PackageComparisonReading = Omit<Nutrient, 'status'> & {
  status?: Nutrient['status'];
  interpretationIds?: string[];
  uncertainty?: string;
};

function canonicalValue(key: NutrientKey, value: number, unit: string): { value: number; unit: 'kcal' | 'g' | 'mg' } | null {
  if (key === 'energy') {
    if (unit === 'kcal') return { value, unit: 'kcal' };
    if (unit === 'kJ') return { value: value / 4.184, unit: 'kcal' };
    return null;
  }
  if (key === 'sodium') {
    if (unit === 'mg') return { value, unit: 'mg' };
    if (unit === 'g') return { value: value * 1000, unit: 'mg' };
    return null;
  }
  if (unit === 'g') return { value, unit: 'g' };
  if (unit === 'mg') return { value: value / 1000, unit: 'g' };
  return null;
}

/** Compare a package reading and a community record only after both have an explicit compatible basis. */
export function compareProductNutrition(
  packageReadings: Nutrient[],
  recordReadings: ProductRecord['nutrients'],
  options: { identityConflict?: boolean; interpretedReadings?: InterpretedNutrientReading[] } = {},
): ProductComparisonRow[] {
  const recordByKey = new Map<NutrientKey, ProductRecord['nutrients'][number]>();
  for (const reading of recordReadings) if (!recordByKey.has(reading.key)) recordByKey.set(reading.key, reading);
  const rows: ProductComparisonRow[] = [];
  const keys = nutrientKeys.filter(key => packageReadings.some(reading => reading.key === key) || recordByKey.has(key) || options.interpretedReadings?.some(reading => reading.key === key));
  for (const key of keys) {
    const recordReading = recordByKey.get(key) ?? null;
    const candidates = packageReadings.filter(reading => reading.key === key);
    const mayCompleteBasis = candidates.length === 1 && candidates[0].status === 'observed' && !candidates[0].basis;
    const interpretations = !candidates.length || mayCompleteBasis
      ? (options.interpretedReadings ?? []).filter(reading => reading.key === key)
      : [];
    const selectedInterpretation = selectConsistentInterpretation(interpretations, recordReading);
    const useInterpretation = !!selectedInterpretation
      && (!candidates.length || (mayCompleteBasis && matchesPackageRows(selectedInterpretation, candidates)));
    const packageReading: PackageComparisonReading | null = !options.identityConflict && useInterpretation
        ? {
          key,
          value: selectedInterpretation.value,
          unit: selectedInterpretation.unit as Nutrient['unit'],
          basis: selectedInterpretation.basis,
          observationIds: [...new Set([...candidates.flatMap(reading => reading.observationIds), ...interpretations.flatMap(reading => reading.observationIds)])],
          interpretationIds: [...new Set(interpretations.flatMap(reading => reading.candidateIds))],
          uncertainty: selectedInterpretation.uncertainty,
        }
      : !options.identityConflict && candidates.length === 1
        ? candidates[0]
        : null;
    const packageReadingSource = !packageReading ? null : packageReading.interpretationIds?.length ? 'gemini-interpretation' : 'package-observation';
    const row: ProductComparisonRow = { key, status: 'comparable', unit: null, basisUnit: null, packageReading, packageReadingSource, recordReading, packagePer100: null, recordPer100: null, difference: null };
    if (options.identityConflict) row.status = 'package-identity-conflict';
    else if (!candidates.length && !packageReading) row.status = interpretations.length ? 'package-reading-conflict' : 'package-reading-missing';
    else if (candidates.length > 0 && (candidates.length !== 1 || candidates[0].status === 'conflict')) row.status = 'package-reading-conflict';
    else if (!recordReading) row.status = 'record-reading-missing';
    else if (!packageReading?.basis) row.status = 'package-basis-unknown';
    else if (!recordReading.basis) row.status = 'record-basis-unknown';
    else if (packageReading.basis.unit !== recordReading.basis.unit) row.status = 'basis-type-mismatch';
    else {
      const packageValue = canonicalValue(key, packageReading.value, packageReading.unit);
      const recordValue = canonicalValue(key, recordReading.value, recordReading.unit);
      if (!packageValue || !recordValue || packageValue.unit !== recordValue.unit) row.status = 'unit-mismatch';
      else {
        const packagePer100 = packageValue.value * 100 / packageReading.basis.amount;
        const recordPer100 = recordValue.value * 100 / recordReading.basis.amount;
        if (![packagePer100, recordPer100].every(Number.isFinite)) row.status = 'unit-mismatch';
        else {
          row.unit = packageValue.unit;
          row.basisUnit = packageReading.basis.unit;
          row.packagePer100 = packagePer100;
          row.recordPer100 = recordPer100;
          row.difference = recordPer100 - packagePer100;
        }
      }
    }
    rows.push(row);
  }
  return rows;
}

function selectConsistentInterpretation(
  readings: InterpretedNutrientReading[],
  record: ProductRecord['nutrients'][number] | null,
): InterpretedNutrientReading | null {
  if (!readings.length || readings.some(reading => !reading.basis?.amount || !reading.unit)) return null;
  const first = readings[0];
  const firstValue = canonicalValue(first.key, first.value, first.unit);
  if (!firstValue) return null;
  const firstPerUnit = firstValue.value / first.basis.amount;
  const consistent = readings.every(reading => {
    if (reading.basis.unit !== first.basis.unit) return false;
    const value = canonicalValue(reading.key, reading.value, reading.unit);
    if (!value || value.unit !== firstValue.unit) return false;
    const perUnit = value.value / reading.basis.amount;
    return Math.abs(perUnit - firstPerUnit) <= Math.max(0.000001, Math.abs(firstPerUnit) * 0.02);
  });
  if (!consistent) return null;
  return [...readings].sort((a, b) => {
    const aMatchesRecord = record?.basis && a.basis.unit === record.basis.unit && a.basis.amount === record.basis.amount ? 0 : 1;
    const bMatchesRecord = record?.basis && b.basis.unit === record.basis.unit && b.basis.amount === record.basis.amount ? 0 : 1;
    const aPerHundred = a.basis.amount === 100 ? 0 : 1;
    const bPerHundred = b.basis.amount === 100 ? 0 : 1;
    return aMatchesRecord - bMatchesRecord || aPerHundred - bPerHundred || a.basis.amount - b.basis.amount;
  })[0];
}
