import {nutrientMassConflict} from './nutrient-mass';
import type { Calculation, NutrientKey, PackageData, PackageReconstructionContent } from './contracts';

export type PortionChoice = { value: number; unit: 'g' | 'ml' };
export type ReconstructedServingPortion = {
  printedText?: string | null;
  quantity: number | null;
  unit: 'g' | 'ml' | null;
  status: string;
  pieceCount?: number | null;
  pieceDescription?: string | null;
};

const smallNumberWords: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Parse only values and piece descriptions explicitly present in the serving's printed text. */
export function normalizeReconstructedServing<T extends ReconstructedServingPortion | null | undefined>(serving: T): T {
  if (!serving?.printedText) return (serving ?? null) as T;
  const text = serving.printedText.normalize('NFKC').trim();
  const amountMatch = text.match(/\b(?:approx(?:imately)?\.?|about|around)?\s*(\d+(?:[.,]\d+)?)\s*(g|grams?|ml|millilit(?:er|re)s?)\b/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(',', '.')) : Number.NaN;
  const amountUnit = amountMatch?.[2]?.toLocaleLowerCase('en') ?? '';
  const unit: 'g' | 'ml' | null = /^g|gram/.test(amountUnit) ? 'g' : /^(?:ml|millilit)/.test(amountUnit) ? 'ml' : null;
  const pieceMatch = text.match(/\b(\d{1,3}|one|a|an|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*){0,2})(?=\s*(?:\(|,|;|$)|\s+(?:approx(?:imately)?\.?|about|around|per)\b)/iu);
  const countText = pieceMatch?.[1]?.toLocaleLowerCase('en');
  const parsedCount = countText ? /^\d+$/.test(countText) ? Number(countText) : smallNumberWords[countText] : undefined;
  const pieceDescription = pieceMatch?.[2]?.replace(/\s+/g, ' ').trim();
  return {
    ...serving,
    ...(serving.quantity === null && serving.unit === null && unit && Number.isFinite(amount) && amount > 0 && amount <= 10000
      ? { quantity: amount, unit }
      : {}),
    ...(serving.pieceCount === null && serving.pieceDescription === null && parsedCount !== undefined && parsedCount > 0 && pieceDescription
      ? { pieceCount: parsedCount, pieceDescription }
      : {}),
  } as T;
}

export function normalizePackageServing(content: PackageReconstructionContent): PackageReconstructionContent {
  return { ...content, serving: normalizeReconstructedServing(content.serving) };
}

const spokenCounts: Record<number, string[]> = {
  1: ['one', 'a', 'an'], 2: ['two'], 3: ['three'], 4: ['four'], 5: ['five'],
  6: ['six'], 7: ['seven'], 8: ['eight'], 9: ['nine'], 10: ['ten'],
  11: ['eleven'], 12: ['twelve'],
};

function normalizePieceWords(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu)?.map(word =>
    word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word,
  ) ?? [];
}

export function asksForDeclaredPieceCount(question: string, serving: ReconstructedServingPortion | null | undefined): boolean {
  const normalizedServing = normalizeReconstructedServing(serving);
  if (!normalizedServing || !['clear', 'provisional'].includes(normalizedServing.status) || !normalizedServing.pieceCount || !normalizedServing.pieceDescription) return false;
  const description = normalizePieceWords(normalizedServing.pieceDescription);
  const questionWords = normalizePieceWords(question);
  if (!description.length || !questionWords.some((_, start) => description.every((part, offset) => questionWords[start + offset] === part))) return false;

  const countTokens = new Set([String(normalizedServing.pieceCount), ...(spokenCounts[normalizedServing.pieceCount] ?? [])]);
  return questionWords.some((word, index) => countTokens.has(word)
    && description.every((part, offset) => questionWords[index + offset + 1] === part));
}

/** True when a question selects a concrete package amount that can use saved deterministic calculations. */
export function hasExplicitPortionRequest(question: string, netWeight?: PortionChoice, serving?: ReconstructedServingPortion | null): boolean {
  const amount = question.match(/\b(\d+(?:\.\d+)?)\s*(g|grams?|ml|millilit(?:er|re)s?)\b/i);
  if (amount) {
    const value = Number(amount[1]);
    if (value > 0 && value <= 2000) return true;
  }
  if (/\bhalf (?:a |the )?(?:pack|packet)\b/i.test(question) && netWeight && netWeight.value > 0) return true;
  const normalizedServing = normalizeReconstructedServing(serving);
  if (asksForDeclaredPieceCount(question, normalizedServing)) return true;
  return !!normalizedServing?.quantity && !!normalizedServing.unit
    && ['clear', 'provisional'].includes(normalizedServing.status)
    && /\b(?:a|one|my|this|that)\s+serving\b/i.test(question);
}

const reconstructedNutrientLabels: Record<NutrientKey, string[]> = {
  energy: ['energy', 'calories', 'calorie'],
  carbohydrate: ['carbohydrate', 'carbohydrates', 'carbs'],
  sugars: ['sugars', 'sugar', 'total sugars', 'total sugar'],
  addedSugars: ['added sugars', 'added sugar'],
  protein: ['protein'],
  fat: ['fat', 'total fat'],
  saturatedFat: ['saturated fat', 'saturated fats', 'sat fat'],
  fiber: ['fibre', 'fiber', 'dietary fibre', 'dietary fiber'],
  sodium: ['sodium'],
  salt: ['salt'],
};

export function reconstructedNutrientKey(value: string): NutrientKey | null {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (/^(?:soluble|insoluble) (?:dietary )?(?:fiber|fibre)$/.test(normalized)) return 'fiber';
  return (Object.keys(reconstructedNutrientLabels) as NutrientKey[]).find(key => reconstructedNutrientLabels[key].some(label =>
    normalized === label.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(),
  )) ?? null;
}

function reconstructedNutrientComponent(key:NutrientKey,row:Pick<NonNullable<PackageData['reconstruction']>['nutritionRows'][number],'nutrient'|'printedLabel'>):string{
  if(key!=='fiber')return key;
  const label=`${row.nutrient} ${row.printedLabel}`.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[_-]+/g,' ');
  if(/\binsoluble\b/.test(label))return 'fiber:insoluble';
  if(/\bsoluble\b/.test(label))return 'fiber:soluble';
  return 'fiber:total';
}

/**
 * Build deterministic, explicitly provisional calculations from traceable saved
 * reconstruction rows. Conflicting rows, unknown bases, and mass/volume
 * conversions are withheld rather than inferred.
 */
export function calculationsFromReconstruction(pkg: PackageData, portion: number, portionUnit: 'g' | 'ml'): Calculation[] {
  const reconstruction = pkg.reconstruction;
  if (!reconstruction?.current || !Number.isFinite(portion) || portion <= 0 || portion > 10000) return [];
  const observations = new Map(pkg.observations.map(observation => [observation.id, observation]));
  const retainedImages = new Set([
    ...pkg.observations.flatMap(observation => observation.imageId ? [observation.imageId] : []),
    ...(pkg.ocrCaptures ?? []).map(capture => capture.imageId),
    ...(pkg.visionCaptures ?? []).map(capture => capture.imageId),
  ]);
  const selected:Array<{ key:NutrientKey; row:typeof reconstruction.nutritionRows[number] }> = [];
  for (const key of Object.keys(reconstructedNutrientLabels) as NutrientKey[]) {
    const eligible = reconstruction.nutritionRows.filter(row => {
      if (!['clear', 'provisional'].includes(row.status) || row.value === null || !row.unit || row.qualifier || !row.basisAmount || !row.basisUnit) return false;
      if(nutrientMassConflict({...row,nutrientKey:key}))return false;
      if (row.basisUnit !== portionUnit || (reconstructedNutrientKey(row.nutrient)??reconstructedNutrientKey(row.printedLabel)) !== key) return false;
      return row.evidence.observationIds.some(id => observations.has(id))
        || row.evidence.imageRegions.some(region => retainedImages.has(region.imageId));
    });
    if (!eligible.length) continue;
    // Distinct printed components (for example total, soluble and insoluble
    // fibre) are separate rows, not conflicts. Within each component, prefer
    // the requested basis, then per-100, and abstain on contradictory duplicate
    // readings at that same basis.
    const components=new Map<string,typeof eligible>();
    for(const row of eligible){
      const component=reconstructedNutrientComponent(key,row);
      components.set(component,[...(components.get(component)??[]),row]);
    }
    for(const rows of components.values()){
      const requestedBasis=rows.find(row=>Math.abs(row.basisAmount!-portion)<=1e-6)?.basisAmount;
      const preferredBasis=requestedBasis!==undefined?requestedBasis:rows.some(row=>row.basisAmount===100)?100:rows[0].basisAmount;
      const candidates=rows.filter(row=>row.basisAmount===preferredBasis);
      const distinctValues=new Set(candidates.map(row=>`${row.value} ${row.unit}`));
      if(distinctValues.size===1)selected.push({key,row:candidates[0]});
    }
  }

  return selected.flatMap(({key,row}) => {
    if (row.basisUnit !== portionUnit || !row.basisAmount || row.value === null || !row.unit) return [];
    const result = row.value * portion / row.basisAmount;
    if (!Number.isFinite(result)) return [];
    const imageIds = [...new Set([
      ...row.evidence.imageRegions.map(region => region.imageId),
      ...row.evidence.observationIds.flatMap(id => {
        const imageId = observations.get(id)?.imageId;
        return imageId && retainedImages.has(imageId) ? [imageId] : [];
      }),
    ])];
    const observationIds = [...new Set(row.evidence.observationIds)];
    if (!observationIds.length && !imageIds.length) return [];
    const basisText = row.basisText || row.columnLabel || `per ${row.basisAmount} ${row.basisUnit}`;
    const id = `reconstruction-${row.rowId.slice(0, 72)}-${portion}-${portionUnit}`;
    const displayNutrient=row.nutrient.trim().replace(/[_-]+/g,' ').replace(/^\p{L}/u,letter=>letter.toLocaleUpperCase('en-IN'))||row.printedLabel;
    const label = `${displayNutrient} in ${portion} ${portionUnit}`;
    const formula = `${row.value} ${row.unit} × ${portion} ${portionUnit} ÷ ${row.basisAmount} ${row.basisUnit}`;
    return [{
      id, label, nutrient: key, input: row.value, inputUnit: row.unit, basisAmount: row.basisAmount,
      portion, portionUnit, result, unit: row.unit, formula,
      evidenceText: `${row.nutrient}: ${row.printedValue ?? `${row.value} ${row.unit}`} ${basisText}; ${formula} = ${result} ${row.unit}; ${row.status === 'provisional' ? 'unverified provisional package interpretation' : 'Gemini package interpretation, not independently verified'}.`,
      observationIds, imageIds, interpretationIds: [row.rowId],
      assumptions: [`Uses a traceable ${row.status} package interpretation; the printed reading has not been independently verified.`],
    } satisfies Calculation];
  });
}

/** Choose a neutral calculation reference from the label, never a user-specific serving guess. */
export function defaultPortion(pkg: { serving?: PortionChoice; netWeight?: PortionChoice; reconstruction?: { current: boolean; serving: ReconstructedServingPortion | null }; nutrients: { status: string; basis: { amount: number; unit: 'g' | 'ml' } | null }[] }): PortionChoice {
  const interpreted = pkg.reconstruction?.current ? normalizeReconstructedServing(pkg.reconstruction.serving) : null;
  const interpretedServing=interpreted
    &&['clear','provisional'].includes(interpreted.status)
    &&interpreted.quantity&&interpreted.unit
    ?{value:interpreted.quantity,unit:interpreted.unit}
    :undefined;
  // Keep an existing package serving authoritative; use the current Gemini
  // reconstruction only when the OCR parser did not supply one.
  const serving=pkg.serving??interpretedServing;
  const declaredBasis = pkg.nutrients.find(n => n.status !== 'conflict' && n.basis)?.basis;
  if (serving && (!declaredBasis || declaredBasis.unit === serving.unit)) return serving;
  if (declaredBasis) return { value: declaredBasis.amount, unit: declaredBasis.unit };
  if (serving) return serving;
  return { value: 100, unit: pkg.netWeight?.unit ?? 'g' };
}

/** Use an amount the user typed in their question, falling back to the current portion. */
export function resolveQuestionPortion(question: string, fallback: PortionChoice, netWeight?: PortionChoice, serving?: ReconstructedServingPortion | null): PortionChoice {
  const normalizedServing = normalizeReconstructedServing(serving);
  const amount = question.match(/\b(\d+(?:\.\d+)?)\s*(g|grams?|ml|millilit(?:er|re)s?)\b/i);
  if (amount) {
    const value = Number(amount[1]);
    if (value > 0 && value <= 2000) return { value, unit: /^(?:ml|millilit)/i.test(amount[2]) ? 'ml' : 'g' };
  }
  if (/\bhalf (?:a |the )?(?:pack|packet)\b/i.test(question) && netWeight) {
    return { value: netWeight.value / 2, unit: netWeight.unit };
  }
  // Reuse a printed piece-count serving only when the question names that
  // exact count and item. Do not estimate the weight of a different count by
  // assuming every piece is identical.
  if (asksForDeclaredPieceCount(question, normalizedServing) && normalizedServing?.quantity && normalizedServing.unit) {
    return { value: normalizedServing.quantity, unit: normalizedServing.unit };
  }
  return fallback;
}
