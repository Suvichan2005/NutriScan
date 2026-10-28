import { calculationSchema, type Calculation, type PackageData } from './contracts';
import { calculationHasPackageEvidence } from './calculation-provenance';
import { reconstructionRowIsSuperseded } from './correction';
import { packageWithRowCorrections } from './reconstruction-correction';
import { calculateReconstructedRow } from './reconstruction-calculation';

export type PortionNutrientChoice = { id: string; label: string; basis: string; calculation: Calculation | null; reason?: string; initial: boolean };
const identity = (row: Calculation) => row.interpretationIds?.length === 1 ? `row:${row.interpretationIds[0]}` : `operation:${row.id}`;
type PrintedRow = NonNullable<PackageData['reconstruction']>['nutritionRows'][number];
const printedIdentity = (row: PrintedRow) => `${row.nutrient}\n${row.printedLabel}`.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
const contradictory = (row: PrintedRow, other: PrintedRow) => other.rowId !== row.rowId && printedIdentity(other) === printedIdentity(row) && other.unit === row.unit && other.basisAmount === row.basisAmount && other.basisUnit === row.basisUnit && other.qualifier === row.qualifier && other.value !== null && row.value !== null && other.value !== row.value && ['clear', 'provisional'].includes(other.status);

/** Explore retained quantities locally. A new nutrient never inherits another row's evidence. */
export function portionNutrientChoices(original: PackageData, supplied: Calculation[]): PortionNutrientChoice[] {
  const pkg = packageWithRowCorrections(original), anchor = supplied[0];
  if (!anchor) return [];
  const choices = new Map<string, PortionNutrientChoice>();
  const add = (calculation: Calculation, initial = false) => {
    if (calculation.portionUnit !== anchor.portionUnit || !calculationHasPackageEvidence(calculation, { package: pkg })) return;
    const source = pkg.reconstruction?.nutritionRows.find(row => calculation.interpretationIds?.includes(row.rowId));
    const id = identity(calculation);
    choices.set(id, { id, label: source?.printedLabel || source?.nutrient || calculation.nutrientLabel || calculation.nutrient || calculation.label,
      basis: `per ${calculation.basisAmount} ${calculation.portionUnit}`, calculation, initial: initial || choices.get(id)?.initial || false });
  };
  supplied.forEach(row => add(row, true));
  if (pkg.reconstruction?.current) for (const row of pkg.reconstruction.nutritionRows) {
    const id = `row:${row.rowId}`;
    if (choices.has(id)) continue;
    const directlyCorrected = pkg.reconstructionCorrections?.some(edit => edit.rowId === row.rowId && row.evidence.observationIds.includes(edit.observationId));
    const competing = pkg.reconstruction.nutritionRows.some(other => contradictory(row, other));
    const unavailable = !directlyCorrected && reconstructionRowIsSuperseded(pkg, row) ? 'Replaced by your correction' : competing ? 'Conflicting readings for this basis' : null;
    const result = unavailable ? null : calculateReconstructedRow(row, row.nutrientKey ?? null, { amount: anchor.portion, unit: anchor.portionUnit }, pkg);
    const calculation = result?.calculations?.[0] ?? null;
    if (calculation && calculationHasPackageEvidence(calculation, { package: pkg })) add(calculation);
    else choices.set(id, { id, label: row.printedLabel || row.nutrient, basis: row.basisAmount && row.basisUnit ? `per ${row.basisAmount} ${row.basisUnit}` : 'Basis missing', calculation: null, initial: false,
      reason: unavailable || (row.qualifier ? 'A limit, not an exact amount' : row.basisUnit && row.basisUnit !== anchor.portionUnit ? 'Different measurement dimension' : row.value === null ? 'Value missing' : 'Needs a readable value and linked basis') });
  }
  // Current explicit corrections (and original observations before reconstruction) remain usable.
  for (const row of pkg.nutrients) {
    if ((pkg.reconstruction?.current && row.status !== 'corrected') || row.status === 'conflict' || !row.basis || row.basis.unit !== anchor.portionUnit) continue;
    const parsed = calculationSchema.safeParse({ id: `portion-${row.key}-${row.basis.amount}-${row.value}`, label: row.key, nutrient: row.key, input: row.value, inputUnit: row.unit,
      basisAmount: row.basis.amount, portion: anchor.portion, portionUnit: anchor.portionUnit, result: row.value * anchor.portion / row.basis.amount, unit: row.unit,
      formula: `${row.value} × ${anchor.portion} ÷ ${row.basis.amount}`, observationIds: row.observationIds, assumptions: [], inputOrigin: row.status === 'corrected' ? 'user-correction' : 'observation' });
    if (parsed.success && ![...choices.values()].some(choice => choice.calculation?.nutrient === row.key && choice.calculation.input === row.value && choice.calculation.inputUnit === row.unit && choice.calculation.basisAmount === row.basis?.amount)) add(parsed.data);
  }
  return [...choices.values()].map(choice => {
    const source = pkg.reconstruction?.nutritionRows.find(row => choice.id === `row:${row.rowId}`);
    const conflict = source && pkg.reconstruction?.nutritionRows.some(other => contradictory(source, other));
    return conflict ? { ...choice, calculation: null, reason: 'Conflicting readings for this basis' } : choice;
  });
}
