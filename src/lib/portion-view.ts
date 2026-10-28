import type { Calculation, PackageData } from './contracts';
import { calculationHasPackageEvidence } from './calculation-provenance';
import { normalizeReconstructedServing } from './portion';
import { scaleCalculationToPortion } from './thread-presentation';
import { portionNutrientChoices } from './portion-nutrients';

export type PortionUnit = 'g' | 'ml' | 'pieces' | 'servings' | 'packages';
export type PortionOption = { unit: PortionUnit; label: string; quantity: number; basisUnit: 'g' | 'ml' };

/** Unit choices come from the operation's current label evidence, never question keywords. */
export function portionView(calculation: Calculation, pkg: PackageData) {
  const physical: PortionOption = { unit: calculation.portionUnit, label: calculation.portionUnit, quantity: 1, basisUnit: calculation.portionUnit };
  const options: PortionOption[] = [physical];
  const linked = calculationHasPackageEvidence(calculation, { package: pkg });
  const serving = pkg.reconstruction?.current ? normalizeReconstructedServing(pkg.reconstruction.serving) : null;
  const count = calculation.countedPortion;
  const retainedObservations = new Set(pkg.observations.map(item => item.id));
  const retainedImages = new Set([...pkg.observations.flatMap(item => item.imageId ? [item.imageId] : []), ...(pkg.visionCaptures ?? []).map(item => item.imageId), ...(pkg.ocrCaptures ?? []).map(item => item.imageId)]);
  const evidenced = (evidence: { observationIds: string[]; imageRegions: { imageId: string }[] }) => evidence.observationIds.some(id => retainedObservations.has(id)) || evidence.imageRegions.some(region => retainedImages.has(region.imageId));
  if (linked && serving && ['clear', 'provisional'].includes(serving.status) && serving.quantity && serving.unit === calculation.portionUnit && evidenced(serving.evidence)) {
    options.push({ unit: 'servings', label: 'servings', quantity: serving.quantity, basisUnit: serving.unit });
    if (serving.pieceCount && serving.pieceCount > 0) options.push({
      unit: 'pieces', label: serving.pieceDescription?.trim().toLocaleLowerCase('en') || 'pieces',
      quantity: serving.quantity / serving.pieceCount, basisUnit: serving.unit,
    });
  }
  const contents = pkg.reconstruction?.current ? (pkg.reconstruction.quantityDeclarations ?? []).filter(item => item.kind === 'net-content' && ['clear', 'provisional'].includes(item.status) && item.quantity && item.unit === calculation.portionUnit && evidenced(item.evidence)) : [];
  if (linked && contents.length === 1) options.push({
    unit: 'packages', label: 'packages', quantity: contents[0].quantity!, basisUnit: calculation.portionUnit,
  });
  const initial = linked && count ? { amount: count.amount, unit: count.unit as PortionUnit }
    : linked && calculation.packagePortion ? { amount: calculation.packagePortion.packageCount, unit: 'packages' as PortionUnit }
    : { amount: calculation.portion, unit: calculation.portionUnit as PortionUnit };
  return { options, initial };
}

/** Conversion preserves a physical amount; unsupported mass/volume or count conversions fail closed. */
export function convertPortion(amount: number, from: PortionOption, to: PortionOption): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || from.basisUnit !== to.basisUnit) return null;
  const result = amount * from.quantity / to.quantity;
  return Number.isFinite(result) && result > 0 && result <= 10_000 ? result : null;
}

export function scalePortion(calculation: Calculation, amount: number, option: PortionOption): number | null {
  return scaleCalculationToPortion(calculation, amount * option.quantity, option.basisUnit);
}

/** Retain the selected amount through nutrient edits; reset only when conversion context changes. */
export function portionViewKey(rows: Calculation[], pkg: PackageData): string {
  return JSON.stringify([rows.map(row => [row.id, row.portionUnit]), portionView(rows[0], pkg)]);
}

/** Tell the agent about the same evidenced controls the application actually renders. */
export function calculatorPresentationForModel(calculation: Calculation, pkg: PackageData) {
  if (!calculationHasPackageEvidence(calculation, { package: pkg })) return null;
  const view = portionView(calculation, pkg);
  return {
    component: 'portion-calculator', location: 'below-answer', title: 'Your portion',
    initial: view.initial,
    controls: { amount: 'editable', unitChoices: view.options.map(({ unit, label }) => ({ unit, label })), nutrientSelection: 'editable on device', availableNutrients: portionNutrientChoices(pkg, [calculation]).filter(choice => choice.calculation).map(({ label, basis }) => ({ label, basis })) },
    expandableDetails: 'Calculation & label details',
  };
}
