import { calculationEvidenceText, calculationSchema, type Calculation, type PackageData } from './contracts';
import { calculationHasPackageEvidence } from './calculation-provenance';
import { reconstructionRowIsSuperseded } from './correction';
import { packageWithRowCorrections } from './reconstruction-correction';
import { calculateReconstructedRow } from './reconstruction-calculation';
import { normalizeReconstructedServing, reconstructionNutrientSubject } from './portion';
import { packageConsistencyIssues } from './package-consistency';

export type PortionNutrientChoice = { id: string; subject: string; label: string; basis: string; calculation: Calculation | null; reason?: string; initial: boolean };
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
    choices.set(id, { id, subject: source ? reconstructionNutrientSubject(source) : calculation.nutrient ?? calculation.nutrientLabel ?? id, label: source?.printedLabel || source?.nutrient || calculation.nutrientLabel || calculation.nutrient || calculation.label,
      basis: `per ${calculation.basisAmount} ${calculation.portionUnit}`, calculation, initial: initial || choices.get(id)?.initial || false });
  };
  const initiallyShown = new Set<string>();
  supplied.forEach(row => {
    const source = pkg.reconstruction?.nutritionRows.find(item=>row.interpretationIds?.includes(item.rowId));
    const subject = source ? reconstructionNutrientSubject(source) : row.nutrient ?? row.nutrientLabel ?? row.id;
    add(row, !initiallyShown.has(subject)); if(choices.get(identity(row))?.calculation)initiallyShown.add(subject);
  });
  if (pkg.reconstruction?.current) for (const row of pkg.reconstruction.nutritionRows) {
    const id = `row:${row.rowId}`;
    if (choices.has(id)) continue;
    const directlyCorrected = pkg.reconstructionCorrections?.some(edit => edit.rowId === row.rowId && row.evidence.observationIds.includes(edit.observationId)) || pkg.nutrients.some(item => item.status === 'corrected' && item.key === row.nutrientKey && item.value === row.value && item.unit === row.unit && item.basis?.amount === row.basisAmount && item.basis?.unit === row.basisUnit && item.observationIds.some(id => row.evidence.observationIds.includes(id)));
    const unavailable = !directlyCorrected && reconstructionRowIsSuperseded(pkg, row) ? 'Replaced by your correction' : null;
    const result = unavailable ? null : calculateReconstructedRow(row, row.nutrientKey ?? null, { amount: anchor.portion, unit: anchor.portionUnit }, pkg);
    const calculation = result?.calculations?.[0] ?? null;
    if (calculation && calculationHasPackageEvidence(calculation, { package: pkg })) add(calculation);
    else choices.set(id, { id, subject: reconstructionNutrientSubject(row), label: row.printedLabel || row.nutrient, basis: row.basisAmount && row.basisUnit ? `per ${row.basisAmount} ${row.basisUnit}` : 'Basis missing', calculation: null, initial: false,
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
    return conflict ? { ...choice, reason: 'Different saved reading' } : choice;
  });
}

export type PortionNutrientGroup = PortionNutrientChoice & { alternatives: PortionNutrientChoice[]; conflicted: boolean };

/** Selection is by nutrient identity; printed columns remain independently inspectable evidence. */
export function portionNutrientGroups(pkg: PackageData, supplied: Calculation[]): PortionNutrientGroup[] {
  const groups = new Map<string, PortionNutrientChoice[]>();
  for (const choice of portionNutrientChoices(pkg, supplied)) groups.set(choice.subject, [...(groups.get(choice.subject) ?? []), choice]);
  const issues = packageConsistencyIssues(pkg);
  return [...groups].map(([subject, alternatives]) => {
    const available = alternatives.filter(choice => choice.calculation);
    const preferred = available.find(choice => choice.calculation!.inputOrigin === 'user-correction')
      ?? available.find(choice => choice.calculation!.basisAmount === 100)
      ?? available[0] ?? alternatives[0];
    const conflicted = issues.some(issue => issue.subject === subject);
    return { ...preferred, id: `nutrient:${subject}`, subject, alternatives, conflicted,
      initial: alternatives.some(choice => choice.initial),
      reason: conflicted ? 'Different saved readings' : preferred.calculation ? undefined : preferred.reason };
  });
}

/** Recompute an existing operation after a correction, without rewriting its historical prose. */
export function refreshPortionCalculations(original: PackageData, operations: Calculation[]): Calculation[] {
  const pkg = packageWithRowCorrections(original);
  const sourceRows = [...(original.reconstruction?.nutritionRows ?? []), ...(original.reconstructionHistory ?? []).flatMap(item => item.nutritionRows), ...(original.reconstructionCorrections ?? []).map(item => item.original)];
  const subject = (calculation: Calculation) => {
    const row = sourceRows.find(item => calculation.interpretationIds?.includes(item.rowId));
    return row ? reconstructionNutrientSubject(row) : calculation.nutrient ? reconstructionNutrientSubject({ nutrient: calculation.nutrient, printedLabel: calculation.nutrient, nutrientKey: calculation.nutrient }) : null;
  };
  const ordered = [...operations.filter(operation => calculationHasPackageEvidence(operation, { package: pkg })), ...operations.filter(operation => !calculationHasPackageEvidence(operation, { package: pkg }))];
  return ordered.flatMap(operation => {
    if (calculationHasPackageEvidence(operation, { package: pkg })) return [operation];
    const family = subject(operation);
    if (!family) return [];
    let candidates = portionNutrientChoices(pkg, [operation]).flatMap(item => item.calculation && subject(item.calculation) === family ? [item.calculation] : []);
    const corrected = candidates.filter(item => item.inputOrigin === 'user-correction');
    if (corrected.length) candidates = corrected;
    else candidates = candidates.filter(item => item.basisAmount === operation.basisAmount && item.inputUnit === operation.inputUnit);
    if (candidates.length !== 1) return [];
    const next = { ...candidates[0], id: operation.id };
    const serving = pkg.reconstruction?.current ? normalizeReconstructedServing(pkg.reconstruction.serving) : null;
    const count = operation.countedPortion;
    const contents = pkg.reconstruction?.quantityDeclarations?.filter(item => item.kind === 'net-content') ?? [];
    const evidence = [];
    if (count && serving?.quantity === count.servingQuantity && serving.unit === count.servingUnit && (count.unit !== 'pieces' || serving.pieceCount === count.piecesPerServing)) { next.countedPortion = count; evidence.push(serving.evidence); }
    const pack = operation.packagePortion;
    if (pack && contents.length === 1 && contents[0].quantity === pack.netContentPerPackage && contents[0].unit === pack.unit) { next.packagePortion = pack; evidence.push(contents[0].evidence); }
    next.observationIds = [...new Set([...next.observationIds, ...evidence.flatMap(item => item.observationIds)])];
    next.imageIds = [...new Set([...(next.imageIds ?? []), ...evidence.flatMap(item => item.imageRegions.map(region => region.imageId))])];
    next.evidenceText = calculationEvidenceText(next);
    const parsed = calculationSchema.safeParse(next);
    return parsed.success && calculationHasPackageEvidence(parsed.data, { package: pkg }) ? [parsed.data] : [];
  });
}
