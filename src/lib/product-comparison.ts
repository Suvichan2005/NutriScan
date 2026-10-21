import { nutrientKeys, type Nutrient, type NutrientKey, type ProductRecord } from './contracts';

export type ProductComparisonStatus = 'comparable' | 'package-identity-conflict' | 'package-reading-missing' | 'record-reading-missing' | 'package-reading-conflict' | 'package-basis-unknown' | 'record-basis-unknown' | 'basis-type-mismatch' | 'unit-mismatch';
export type ProductComparisonRow = {
  key: NutrientKey;
  status: ProductComparisonStatus;
  unit: 'kcal' | 'g' | 'mg' | null;
  basisUnit: 'g' | 'ml' | null;
  packageReading: Nutrient | null;
  recordReading: ProductRecord['nutrients'][number] | null;
  packagePer100: number | null;
  recordPer100: number | null;
  difference: number | null;
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
export function compareProductNutrition(packageReadings: Nutrient[], recordReadings: ProductRecord['nutrients'], options: { identityConflict?: boolean } = {}): ProductComparisonRow[] {
  const recordByKey = new Map<NutrientKey, ProductRecord['nutrients'][number]>();
  for (const reading of recordReadings) if (!recordByKey.has(reading.key)) recordByKey.set(reading.key, reading);
  const rows: ProductComparisonRow[] = [];
  const keys = nutrientKeys.filter(key => packageReadings.some(reading => reading.key === key) || recordByKey.has(key));
  for (const key of keys) {
    const recordReading = recordByKey.get(key) ?? null;
    const candidates = packageReadings.filter(reading => reading.key === key);
    const packageReading = !options.identityConflict && candidates.length === 1 ? candidates[0] : null;
    const row: ProductComparisonRow = { key, status: 'comparable', unit: null, basisUnit: null, packageReading, recordReading, packagePer100: null, recordPer100: null, difference: null };
    if (options.identityConflict) row.status = 'package-identity-conflict';
    else if (!candidates.length) row.status = 'package-reading-missing';
    else if (candidates.length !== 1 || candidates[0].status === 'conflict') row.status = 'package-reading-conflict';
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
