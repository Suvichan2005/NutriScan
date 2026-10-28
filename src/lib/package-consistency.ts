import { packageSchema, type PackageData, type PackageReconstruction, type PackageClarificationDecision } from './contracts';
import { reconstructionNutrientSubject } from './portion';
import { applyReconstructionRowCorrection, packageWithRowCorrections } from './reconstruction-correction';
import { applyNutrientCorrection } from './correction';

type Row = PackageReconstruction['nutritionRows'][number];
export type ConsistencyReading = { row: Row; revision: number; current: boolean };
export type PackageConsistencyIssue = { id: string; subject: string; label: string; reason: string; readings: ConsistencyReading[]; decision?: PackageClarificationDecision };
export const nutrientSubject = reconstructionNutrientSubject;
const units: Record<string, { dimension: string; factor: number }> = { g: { dimension: 'mass', factor: 1 }, mg: { dimension: 'mass', factor: .001 }, 'µg': { dimension: 'mass', factor: .000001 }, mcg: { dimension: 'mass', factor: .000001 }, kcal: { dimension: 'energy', factor: 1 }, kJ: { dimension: 'energy', factor: 1 / 4.184 } };
const eligible = (row: Row) => ['clear', 'provisional'].includes(row.status) && row.value !== null && !row.qualifier && !!row.unit && !!units[row.unit] && !!row.basisAmount && !!row.basisUnit;
// Printed decimal resolution supports a rounding interval; it never changes a reading.
function quantum(row: Row): number {
  const candidates = row.printedValue?.match(/\d+(?:\.\d+)?/g) ?? [];
  const literal = candidates.find(text => Number(text) === row.value) ?? String(row.value);
  const decimals = literal.split('.')[1]?.length ?? 0;
  return 10 ** -Math.min(decimals, 12);
}
function disagrees(a: Row, b: Row): boolean {
  if (!eligible(a) || !eligible(b) || a.basisUnit !== b.basisUnit || units[a.unit!].dimension !== units[b.unit!].dimension) return false;
  const interval = (row: Row) => {
    const factor = units[row.unit!].factor / row.basisAmount!;
    return { low: Math.max(0, row.value! - quantum(row) / 2) * factor, high: (row.value! + quantum(row) / 2) * factor };
  };
  const left = interval(a), right = interval(b);
  // Additional 1% relative slack avoids calling ordinary printed rounding a conflict.
  return left.low > right.high * 1.01 || right.low > left.high * 1.01;
}
function hash(value: unknown): string {
  let result = 2166136261;
  for (const char of JSON.stringify(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0).toString(16);
}
function sharedSource(a: Pick<Row, 'evidence'>, b: Pick<Row, 'evidence'>) {
  return a.evidence.observationIds.some(id => b.evidence.observationIds.includes(id)) || a.evidence.imageRegions.some(region => b.evidence.imageRegions.some(other => other.imageId === region.imageId));
}

/** Changed additive names are investigation leads, not proof that synonyms conflict or an ingredient is unsafe. */
export function additiveInterpretationChanges(pkg: PackageData) {
  const current = pkg.reconstruction;
  if (!current?.current) return [];
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
  return current.additives.flatMap(item => {
    if (!item.code) return [];
    const earlier = (pkg.reconstructionHistory ?? []).flatMap(revision => revision.additives.filter(other => other.code && normalize(other.code) === normalize(item.code!) && sharedSource(item, other) && normalize(other.normalizedName || other.printedName) !== normalize(item.normalizedName || item.printedName)).map(other => ({ revision: revision.revision, name: other.normalizedName || other.printedName })));
    return earlier.length ? [{ code: item.code, currentName: item.normalizedName || item.printedName, earlier, limitation: 'Names differ across interpretations; this may be normalization or a misreading. Inspect the original and resolve identity before making effects or permission claims.' }] : [];
  }).slice(0, 12);
}

/** Dimensional comparison, not visual adjudication or a guess at missing digits. */
export function packageConsistencyIssues(original: PackageData): PackageConsistencyIssue[] {
  const pkg = packageWithRowCorrections(original), current = pkg.reconstruction;
  if (!current?.current) return [];
  const groups = new Map<string, ConsistencyReading[]>();
  for (const row of current.nutritionRows.filter(eligible)) groups.set(nutrientSubject(row), [...(groups.get(nutrientSubject(row)) ?? []), { row, revision: current.revision, current: true }]);
  const issues: PackageConsistencyIssue[] = [];
  for (const [subject, active] of groups) {
    if (pkg.nutrients.some(item => item.status === 'corrected' && item.key === subject)) continue;
    if (pkg.clarificationDecisions?.some(item => item.subject === subject && item.decision === 'confirm' && active.some(reading => reading.row.rowId === item.preferredRowId))) continue;
    const historical = (pkg.reconstructionHistory ?? []).flatMap(revision => revision.nutritionRows.filter(row => eligible(row) && nutrientSubject(row) === subject && active.some(reading => sharedSource(reading.row, row))).map(row => ({ row, revision: revision.revision, current: false })));
    const readings = [...active, ...historical];
    const mismatch = readings.some((a, index) => readings.slice(index + 1).some(b => (a.current || b.current) && disagrees(a.row, b.row)));
    if (!mismatch) continue;
    const unique = readings.filter((item, index) => readings.findIndex(other => other.row.value === item.row.value && other.row.unit === item.row.unit && other.row.basisAmount === item.row.basisAmount && other.row.basisUnit === item.row.basisUnit) === index).slice(0, 8);
    const id = `nutrition-${hash([subject, unique.map(item => [item.row.value, item.row.unit, item.row.basisAmount, item.row.basisUnit]).sort()])}`;
    const decision = pkg.clarificationDecisions?.find(item => item.id === id);
    issues.push({ id, subject, label: active[0].row.printedLabel || active[0].row.nutrient, readings: unique, decision,
      reason: active.some((a, index) => active.slice(index + 1).some(b => disagrees(a.row, b.row))) ? 'The printed columns give different estimates beyond normal rounding.' : 'A later reading differs from an earlier reading of the same evidence.' });
  }
  return issues.slice(0, 20);
}

/** Resolves against the currently retained issue; callers cannot inject arbitrary evidence. */
export function resolvePackageConsistency(pkg: PackageData, id: string, choice: number | 'skip', correction?: { value: number; unit: 'g' | 'mg' | 'µg' | 'mcg' | 'kcal' | 'kJ'; basisAmount: number; basisUnit: 'g' | 'ml' }): PackageData {
  const issue = packageConsistencyIssues(pkg).find(item => item.id === id);
  if (!issue) throw new Error('This label detail has changed. Review the current package.');
  let next = pkg;
  let preferredRowId: string | undefined;
  if (choice !== 'skip') {
    const selected = issue.readings[choice];
    if (!selected) throw new Error('Choose a retained reading.');
    const target = selected.current ? selected.row : issue.readings.find(item => item.current && item.row.basisAmount === selected.row.basisAmount && item.row.basisUnit === selected.row.basisUnit)?.row;
    if (!target) throw new Error('Review this earlier reading in Package details before applying it.');
    const row = selected.row;
    const fields = { value: correction?.value ?? row.value!, unit: correction?.unit ?? row.unit!, basisAmount: correction?.basisAmount ?? row.basisAmount!, basisUnit: correction?.basisUnit ?? row.basisUnit! };
    if (target.nutrientKey && issue.subject === target.nutrientKey) {
      const normalizeMass = !['energy', 'sodium', 'salt'].includes(target.nutrientKey) && units[fields.unit]?.dimension === 'mass';
      next = applyNutrientCorrection(pkg, { ...fields, ...(normalizeMass ? {value:fields.value * units[fields.unit].factor,unit:'g' as const} : {unit:fields.unit as 'g' | 'mg' | 'kcal' | 'kJ'}), key: target.nutrientKey, sourceObservationIds: target.evidence.observationIds });
    }
    else {
      next = applyReconstructionRowCorrection(pkg, { ...fields, unit: fields.unit as 'g' | 'mg' | 'µg' | 'mcg' | 'kcal' | 'kJ', rowId: target.rowId, label: row.printedLabel || row.nutrient, qualifier: null }, true);
      next = { ...next, reconstructionCorrections: next.reconstructionCorrections?.map(edit => edit.rowId === target.rowId ? { ...edit, reading: { ...edit.reading, nutrient: target.nutrient, printedLabel: target.printedLabel } } : edit) };
    }
    preferredRowId = target.rowId;
  }
  return packageSchema.parse({ ...next, clarificationDecisions: [...(next.clarificationDecisions ?? []).filter(item => item.id !== id && !(preferredRowId && item.subject === issue.subject && item.decision === 'confirm')), { id, subject: issue.subject, decision: choice === 'skip' ? 'skip' : 'confirm', ...(preferredRowId ? { preferredRowId } : {}), updatedAt: new Date().toISOString() }].slice(-60) });
}

export function consistencyEstimates(issue: PackageConsistencyIssue, amount: number, unit: 'g' | 'ml') {
  return issue.readings.filter(item => eligible(item.row) && item.row.basisUnit === unit).map(item => ({ rowId: item.row.rowId, revision: item.revision, value: item.row.value! * amount / item.row.basisAmount!, unit: item.row.unit!, printedValue: item.row.value, basisAmount: item.row.basisAmount }));
}

export function consistencyContext(pkg: PackageData) {
  return packageConsistencyIssues(pkg).map(issue => ({ id: issue.id, subject: issue.subject, label: issue.label, reason: issue.reason, decision: issue.decision?.decision ?? 'pending', readings: issue.readings.map(({ row, revision, current }) => ({ rowId: row.rowId, value: row.value, unit: row.unit, basisAmount: row.basisAmount, basisUnit: row.basisUnit, revision, current })) }));
}

export function consistencyRange(issue: PackageConsistencyIssue, amount: number, basisUnit: 'g' | 'ml', resultUnit: string): [number, number] | null {
  const target = units[resultUnit];
  if (!target) return null;
  const values = consistencyEstimates(issue, amount, basisUnit).filter(item => units[item.unit]?.dimension === target.dimension).map(item => item.value * units[item.unit].factor / target.factor);
  return values.length > 1 ? [Math.min(...values), Math.max(...values)] : null;
}
