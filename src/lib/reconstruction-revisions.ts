import { packageReconstructionContentSchema, packageSchema, type PackageData, type PackageReconstruction, type PackageReconstructionContent } from './contracts';

export type ReconstructionUpdateDecision = {
  promote: boolean;
  reason: 'initial' | 'preserves-and-adds' | 'omits-saved-details' | 'disagrees-with-saved-reading';
};

function normalized(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function nutrientKey(value: string): string {
  const text = normalized(value);
  if (/\bcarbohydrate|\bcarbs?\b/.test(text)) return 'carbohydrate';
  if (/\bprotein\b/.test(text)) return 'protein';
  if (/\b(?:total )?fat\b/.test(text)) return 'fat';
  if (/\badded sugars?\b/.test(text)) return 'added sugars';
  if (/\b(?:total )?sugars?\b/.test(text)) return 'sugars';
  if (/\b(?:dietary )?fib(?:re|er)\b/.test(text)) return 'fibre';
  if (/\bsodium\b/.test(text)) return 'sodium';
  if (/\bsalt\b/.test(text)) return 'salt';
  if (/\benergy|calories\b/.test(text)) return 'energy';
  return text;
}

function normalizedBasis(row: PackageReconstructionContent['nutritionRows'][number]): string {
  if (row.basisAmount !== null && row.basisUnit) {
    return `${row.basisAmount}:${row.basisUnit}`;
  }

  const text = normalized(row.basisText || row.columnLabel);
  const measuredBasis = text.match(/\b(?:per\s*)?(\d+(?:\.\d+)?)\s*(g|grams?|ml|millilit(?:er|re)s?)\b/);
  if (measuredBasis) {
    const unit = /^g|gram/.test(measuredBasis[2]) ? 'g' : 'ml';
    return `${Number(measuredBasis[1])}:${unit}`;
  }
  if (/\bserv(?:e|ing)\b/.test(text)) return 'serving';
  return text;
}

function rowKey(row: PackageReconstructionContent['nutritionRows'][number]): string {
  const nutrient = nutrientKey(row.nutrient || row.printedLabel);
  const basis = normalizedBasis(row);
  return `${nutrient}|${basis}`;
}

function mergeEvidence(previous: PackageReconstructionContent['identity']['evidence'], next: PackageReconstructionContent['identity']['evidence']) {
  const imageRegions = new Map<string, typeof previous.imageRegions[number]>();
  for (const item of [...previous.imageRegions, ...next.imageRegions]) {
    imageRegions.set(`${item.imageId}:${JSON.stringify(item.region)}`, item);
  }
  return {
    observationIds: [...new Set([...previous.observationIds, ...next.observationIds])].slice(0, 32),
    imageRegions: [...imageRegions.values()].slice(0, 12),
  };
}

function rowBasis(row: PackageReconstructionContent['nutritionRows'][number]) {
  return row.basisAmount !== null && row.basisUnit
    ? `per ${row.basisAmount} ${row.basisUnit}`
    : row.basisText || row.columnLabel || 'basis unresolved';
}

function rowReading(row: PackageReconstructionContent['nutritionRows'][number]) {
  const value = row.printedValue ?? (row.value === null ? 'unreadable' : `${row.value} ${row.unit ?? ''}`.trim());
  return `${value} ${rowBasis(row)}`.trim();
}

function servingReading(serving: NonNullable<PackageReconstruction['serving']>) {
  return serving.printedText
    ?? `${serving.pieceCount ?? '?'} ${serving.pieceDescription ?? 'pieces'}${serving.quantity !== null && serving.unit ? `, about ${serving.quantity} ${serving.unit}` : ''}`;
}

const statusRank = { clear: 0, provisional: 1, ambiguous: 2, conflict: 3, unreadable: 4 } as const;
function conservativeStatus<T extends keyof typeof statusRank>(previous: T, next: T): T {
  return statusRank[previous] >= statusRank[next] ? previous : next;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    const prior = result.get(itemKey);
    if (!prior) result.set(itemKey, item);
  }
  return [...result.values()];
}

/**
 * Combine fields from a partial recheck without replacing an active reading.
 * Only matching values are coalesced; contradictory values are left out and
 * reported so the caller can keep the whole recheck as an alternative.
 */
export function mergeCompatibleReconstruction(
  previous: PackageReconstruction,
  next: PackageReconstructionContent,
): { content: PackageReconstructionContent; conflicts: string[] } {
  const conflicts: string[] = [];
  const unresolved = [...previous.unresolved, ...next.unresolved];
  const addConflict = (field: string, reason: string, evidence: PackageReconstructionContent['identity']['evidence']) => {
    conflicts.push(field);
    unresolved.push({ field: field.slice(0, 120), reason: reason.slice(0, 500), evidence });
  };

  const identity = { ...previous.identity };
  let identityConflict = false;
  for (const field of ['brand', 'name', 'variant'] as const) {
    const oldValue = previous.identity[field];
    const newValue = next.identity[field];
    const comparison = sameIdentityPart(oldValue, newValue);
    if (!oldValue && newValue) identity[field] = newValue;
    else if (oldValue && newValue && comparison === 'different') {
      identityConflict = true;
      identity[field] = null;
      addConflict(`identity.${field}`, `Saved reading: “${oldValue}”. Recheck: “${newValue}”. Both remain separate until the package identity is reviewed.`, mergeEvidence(previous.identity.evidence, next.identity.evidence));
    }
  }
  identity.evidence = mergeEvidence(previous.identity.evidence, next.identity.evidence);
  identity.status = identityConflict ? 'conflict' : conservativeStatus(previous.identity.status, next.identity.status);

  let serving = previous.serving;
  if (!serving) serving = next.serving;
  else if (next.serving) {
    const conflict = serving.status === 'conflict' || next.serving.status === 'conflict' || servingDisagreement(serving, next.serving);
    if (conflict) {
      addConflict('serving', `Saved reading: “${servingReading(serving)}”. Recheck: “${servingReading(next.serving)}”. Both definitions are retained as alternatives; the serving is withheld from calculations.`, mergeEvidence(serving.evidence, next.serving.evidence));
      serving = {
        printedText: null, quantity: null, unit: null, pieceCount: null, pieceDescription: null,
        status: 'conflict', evidence: mergeEvidence(serving.evidence, next.serving.evidence),
      };
    }
    else serving = {
      ...serving,
      printedText: serving.printedText ?? next.serving.printedText,
      quantity: serving.quantity ?? next.serving.quantity,
      unit: serving.unit ?? next.serving.unit,
      pieceCount: serving.pieceCount ?? next.serving.pieceCount,
      pieceDescription: serving.pieceDescription ?? next.serving.pieceDescription,
      status: conservativeStatus(serving.status, next.serving.status),
      evidence: mergeEvidence(serving.evidence, next.serving.evidence),
    };
  }

  const nutritionRows = [...previous.nutritionRows];
  for (const item of next.nutritionRows) {
    const index = nutritionRows.findIndex(row => rowKey(row) === rowKey(item));
    if (index < 0) {
      nutritionRows.push(item);
      continue;
    }
    const old = nutritionRows[index];
    const disagrees = (old.value !== null && item.value !== null && old.value !== item.value)
      || (old.unit !== null && item.unit !== null && normalized(old.unit) !== normalized(item.unit))
      || (old.qualifier !== null && item.qualifier !== null && normalized(old.qualifier) !== normalized(item.qualifier));
    if (disagrees || old.status === 'conflict' || item.status === 'conflict') {
      if (disagrees) addConflict(
        `nutrition.${nutrientKey(old.nutrient || old.printedLabel)}`,
        `Saved reading: “${rowReading(old)}”. Recheck: “${rowReading(item)}”. Both remain in revision history; this basis is withheld from calculations.`,
        mergeEvidence(old.evidence, item.evidence),
      );
      nutritionRows[index] = {
        ...old,
        printedValue: null,
        value: null,
        unit: old.unit === item.unit ? old.unit : null,
        qualifier: old.qualifier === item.qualifier ? old.qualifier : null,
        status: 'conflict',
        evidence: mergeEvidence(old.evidence, item.evidence),
      };
      continue;
    }
    nutritionRows[index] = {
      ...old,
      printedValue: old.printedValue ?? item.printedValue,
      value: old.value ?? item.value,
      unit: old.unit ?? item.unit,
      columnLabel: old.columnLabel ?? item.columnLabel,
      basisText: old.basisText ?? item.basisText,
      basisAmount: old.basisAmount ?? item.basisAmount,
      basisUnit: old.basisUnit ?? item.basisUnit,
      qualifier: old.qualifier ?? item.qualifier,
      status: conservativeStatus(old.status, item.status),
      evidence: mergeEvidence(old.evidence, item.evidence),
    };
  }

  const ingredients = [...previous.ingredients];
  for (const item of next.ingredients) {
    const index = ingredients.findIndex(old => ingredientMatch(old, item));
    if (index < 0) {
      ingredients.push(item);
      continue;
    }
    const old = ingredients[index];
    const percentageDisagreement = old.printedPercentage !== null && item.printedPercentage !== null && old.printedPercentage !== item.printedPercentage;
    if (percentageDisagreement || old.status === 'conflict' || item.status === 'conflict') {
      if (percentageDisagreement) addConflict(
        `ingredient.${normalized(old.normalizedName || old.name)}`,
        `Saved reading: ${old.printedPercentage}%. Recheck: ${item.printedPercentage}%. Both remain in revision history; the percentage is withheld.`,
        mergeEvidence(old.evidence, item.evidence),
      );
      ingredients[index] = {
        ...old,
        printedText: old.normalizedName || old.name,
        printedPercentage: null,
        status: 'conflict',
        evidence: mergeEvidence(old.evidence, item.evidence),
      };
      continue;
    }
    ingredients[index] = {
      ...old,
      printedText: old.printedText.length >= item.printedText.length ? old.printedText : item.printedText,
      printedPercentage: old.printedPercentage ?? item.printedPercentage,
      normalizedName: old.normalizedName ?? item.normalizedName,
      status: conservativeStatus(old.status, item.status),
      evidence: mergeEvidence(old.evidence, item.evidence),
    };
  }

  const additives = [...previous.additives];
  for (const item of next.additives) {
    const index = additives.findIndex(old => item.code ? old.code === item.code : !old.code && normalized(old.normalizedName || old.printedName) === normalized(item.normalizedName || item.printedName));
    if (index < 0) additives.push(item);
    else additives[index] = { ...additives[index], normalizedName: additives[index].normalizedName ?? item.normalizedName, evidence: mergeEvidence(additives[index].evidence, item.evidence), status: conservativeStatus(additives[index].status, item.status) };
  }

  const statements = [...previous.statements];
  for (const item of next.statements) {
    const index = statements.findIndex(old => old.kind === item.kind && normalized(old.text) === normalized(item.text));
    if (index < 0) statements.push(item);
    else statements[index] = { ...statements[index], evidence: mergeEvidence(statements[index].evidence, item.evidence), status: conservativeStatus(statements[index].status, item.status) };
  }
  const regions = uniqueBy([...previous.regions, ...next.regions], item => `${item.imageId}:${item.role}:${JSON.stringify(item.region)}`).map(item => {
    const matching = [...previous.regions, ...next.regions].filter(other => other.imageId === item.imageId && other.role === item.role && JSON.stringify(other.region) === JSON.stringify(item.region));
    return { ...item, observationIds: [...new Set(matching.flatMap(region => region.observationIds))].slice(0, 32) };
  });
  const mergedUnresolved = uniqueBy(unresolved, item => `${normalized(item.field)}:${normalized(item.reason)}`).map(item => {
    const matching = unresolved.filter(other => normalized(other.field) === normalized(item.field) && normalized(other.reason) === normalized(item.reason));
    return { ...item, evidence: matching.reduce((evidence, other) => mergeEvidence(evidence, other.evidence), item.evidence) };
  });
  const content = {
    identity, serving, nutritionRows, ingredients, additives, statements, regions,
    unresolved: mergedUnresolved,
    interpretationNote: previous.interpretationNote || next.interpretationNote,
  };
  const parsed = packageReconstructionContentSchema.safeParse(content);
  if (!parsed.success) return { content: previous, conflicts: [...conflicts, 'merged-reconstruction-contract'] };
  return { content: parsed.data, conflicts: [...new Set(conflicts)] };
}

function sameIdentityPart(previous: string | null, next: string | null): 'same' | 'missing' | 'different' {
  if (!previous) return 'same';
  if (!next) return 'missing';
  const left = normalized(previous);
  const right = normalized(next);
  if (left === right) return 'same';
  const leftWords = new Set(left.split(' ').filter(Boolean));
  const rightWords = new Set(right.split(' ').filter(Boolean));
  const overlap = [...leftWords].filter(word => rightWords.has(word)).length;
  const similarity = overlap / Math.max(leftWords.size, rightWords.size, 1);
  return similarity >= 0.7 ? 'same' : 'different';
}

function servingDisagreement(previous: NonNullable<PackageReconstruction['serving']>, next: NonNullable<PackageReconstructionContent['serving']>): boolean {
  return (previous.quantity !== null && next.quantity !== null && previous.quantity !== next.quantity)
    || (previous.unit !== null && next.unit !== null && previous.unit !== next.unit)
    || (previous.pieceCount !== null && next.pieceCount !== null && previous.pieceCount !== next.pieceCount)
    || (previous.pieceDescription !== null && next.pieceDescription !== null
      && normalized(previous.pieceDescription) !== normalized(next.pieceDescription));
}

function isMissingServingDetail(previous: NonNullable<PackageReconstruction['serving']>, next: NonNullable<PackageReconstructionContent['serving']>): boolean {
  return (previous.quantity !== null && next.quantity === null)
    || (previous.unit !== null && next.unit === null)
    || (previous.pieceCount !== null && next.pieceCount === null)
    || (previous.pieceDescription !== null && next.pieceDescription === null)
    || (previous.printedText !== null && next.printedText === null);
}

function ingredientMatch(previous: PackageReconstruction['ingredients'][number], next: PackageReconstructionContent['ingredients'][number]): boolean {
  const left = normalized(previous.normalizedName || previous.name);
  const right = normalized(next.normalizedName || next.name);
  if (left === right) return true;
  const leftWords = new Set(left.split(' ').filter(word => word.length > 2));
  const rightWords = new Set(right.split(' ').filter(word => word.length > 2));
  if (!leftWords.size || !rightWords.size) return false;
  const overlap = [...leftWords].filter(word => rightWords.has(word)).length;
  return overlap / Math.max(leftWords.size, rightWords.size) >= 0.9;
}

/**
 * A forced recheck may add a revision, but it cannot silently erase saved
 * package detail or replace it with a contradictory interpretation. The new
 * revision remains available for review when it cannot safely be promoted.
 */
export function decideReconstructionUpdate(
  previous: PackageReconstruction | null | undefined,
  next: PackageReconstructionContent,
): ReconstructionUpdateDecision {
  if (!previous) return { promote: true, reason: 'initial' };

  let omitted = false;
  let disagrees = false;

  for (const key of ['brand', 'name', 'variant'] as const) {
    const comparison = sameIdentityPart(previous.identity[key], next.identity[key]);
    if (comparison === 'missing') omitted = true;
    if (comparison === 'different') disagrees = true;
  }

  if (previous.serving) {
    if (!next.serving) omitted = true;
    else {
      omitted ||= isMissingServingDetail(previous.serving, next.serving);
      disagrees ||= servingDisagreement(previous.serving, next.serving);
    }
  }

  const nextRows = new Map(next.nutritionRows.map(row => [rowKey(row), row]));
  for (const row of previous.nutritionRows) {
    if (row.value === null || !row.unit) continue;
    const candidate = nextRows.get(rowKey(row));
    if (!candidate) {
      omitted = true;
      continue;
    }
    if (candidate.value === null || !candidate.unit) omitted = true;
    else if (candidate.value !== row.value || candidate.unit !== row.unit) disagrees = true;
    if (candidate.status === 'ambiguous' || candidate.status === 'conflict' || candidate.status === 'unreadable') omitted = true;
  }

  for (const ingredient of previous.ingredients) {
    const candidate = next.ingredients.find(item => ingredientMatch(ingredient, item));
    if (!candidate) {
      omitted = true;
      continue;
    }
    if (ingredient.printedPercentage !== null && candidate.printedPercentage === null) omitted = true;
    else if (ingredient.printedPercentage !== null && candidate.printedPercentage !== null
      && ingredient.printedPercentage !== candidate.printedPercentage) disagrees = true;
  }

  for (const additive of previous.additives) {
    const candidate = next.additives.find(item => additive.code
      ? item.code === additive.code
      : normalized(item.normalizedName || item.printedName) === normalized(additive.normalizedName || additive.printedName));
    if (!candidate) omitted = true;
  }

  for (const statement of previous.statements) {
    if (!next.statements.some(item => item.kind === statement.kind && normalized(item.text) === normalized(statement.text))) omitted = true;
  }

  if (disagrees) return { promote: false, reason: 'disagrees-with-saved-reading' };
  if (omitted) return { promote: false, reason: 'omits-saved-details' };
  return { promote: true, reason: 'preserves-and-adds' };
}

/** Promote a user-selected archived interpretation and retain the former active revision. */
export function activateReconstructionRevision(pkg: PackageData, revision: number): PackageData | null {
  const selected = pkg.reconstructionHistory?.find(item => item.revision === revision);
  if (!selected) return null;
  const current = pkg.reconstruction?.current ? pkg.reconstruction : undefined;
  const merged = current ? mergeCompatibleReconstruction(current, selected) : null;
  if (merged?.conflicts.includes('merged-reconstruction-contract')) return null;
  const allRevisions = [pkg.reconstruction?.revision ?? 0, ...(pkg.reconstructionHistory ?? []).map(item => item.revision)];
  const nextRevision = Math.max(...allRevisions) + 1;
  if (current && nextRevision > 100000) return null;
  const active = current
    ? { ...merged!.content, revision: nextRevision, updatedAt: new Date().toISOString(), model: `local evidence merge r${current.revision}+r${selected.revision}`, current: true as const }
    : { ...selected, current: true as const };
  const otherHistory = (pkg.reconstructionHistory ?? []).filter(item => item.revision !== revision && item.revision !== current?.revision);
  const history = current
    ? [
        ...otherHistory.sort((a, b) => b.revision - a.revision).slice(0, 3),
        { ...current, current: false as const },
        { ...selected, current: false as const },
      ].sort((a, b) => a.revision - b.revision)
    : [...otherHistory].sort((a, b) => a.revision - b.revision).slice(-5);
  const parsed = packageSchema.safeParse({ ...pkg, reconstruction: active, reconstructionHistory: history });
  return parsed.success ? parsed.data : null;
}

