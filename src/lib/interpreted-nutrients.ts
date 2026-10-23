import {
  nutrientKeys,
  type Nutrient,
  type NutrientKey,
  type Observation,
  type PackageData,
  type TentativeStructuredCandidate,
} from './contracts';

export type InterpretedNutrientReading = {
  key: NutrientKey;
  value: number;
  unit: NonNullable<TentativeStructuredCandidate['unit']>;
  basis: NonNullable<TentativeStructuredCandidate['basis']>;
  candidateIds: string[];
  observationIds: string[];
  imageIds: string[];
  uncertainty: string;
};

export type WithheldNutrientInterpretation = {
  candidateId: string;
  key: NutrientKey | null;
  observationIds: string[];
  reason: string;
};

export type InterpretedNutrition = {
  readings: InterpretedNutrientReading[];
  withheld: WithheldNutrientInterpretation[];
};

type RoleEvidence = {
  observation: Observation;
  words: NonNullable<Observation['ocrWords']>[number][];
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
  imageWidth: number;
  imageHeight: number;
  imageId: string;
  runId: string;
};

const labels: Record<NutrientKey, string[]> = {
  energy: ['energy', 'energy value', 'calories', 'calorie', 'ऊर्जा', 'ऊर्जा मान'],
  carbohydrate: ['carbohydrate', 'carbohydrates', 'carbs', 'कार्बोहाइड्रेट'],
  sugars: ['sugars', 'sugar', 'total sugars', 'total sugar', 'शर्करा', 'कुल शर्करा'],
  addedSugars: ['added sugars', 'added sugar', 'अतिरिक्त शर्करा', 'जोड़ी गई शर्करा'],
  protein: ['protein', 'प्रोटीन'],
  fat: ['fat', 'total fat', 'वसा', 'कुल वसा'],
  saturatedFat: ['saturated fat', 'saturated fats', 'sat fat', 'संतृप्त वसा'],
  fiber: ['fibre', 'fiber', 'dietary fibre', 'dietary fiber', 'आहारीय रेशा', 'आहार रेशा'],
  sodium: ['sodium', 'सोडियम'],
  salt: ['salt', 'नमक'],
};

const normalizedText = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const close = (a: number, b: number, tolerance = Math.max(1e-7, Math.abs(a) * 1e-9)) => Math.abs(a - b) <= tolerance;

function nutrientKey(value: string | null): NutrientKey | null {
  if (!value) return null;
  const normalized = normalizedText(value);
  return nutrientKeys.find(key => key === value || labels[key].some(label => normalizedText(label) === normalized)) ?? null;
}

function labelMatches(text: string, key: NutrientKey): boolean {
  const normalized = normalizedText(text.replace(/\([^)]*\)/g, ' '));
  return labels[key].some(label => normalizedText(label) === normalized);
}

function wordsForRole(
  pkg: PackageData,
  candidate: TentativeStructuredCandidate,
  role: 'label' | 'value' | 'unit' | 'basis',
): RoleEvidence | null {
  const references = (candidate.ocrWordEvidence ?? []).filter(reference => reference.role === role);
  if (references.length !== 1) return null;
  const reference = references[0];
  if (!candidate.observationIds.includes(reference.observationId)) return null;
  const observation = pkg.observations.find(item => item.id === reference.observationId);
  if (!observation || observation.origin !== 'ocr' || observation.field !== 'ocr-line' || !observation.imageId || !observation.readingOrder || !observation.ocrWords) return null;
  const capture = pkg.ocrCaptures?.find(item => item.imageId === observation.imageId && item.runId === observation.readingOrder!.runId && item.bboxCoordinateSpace === 'prepared-image-pixels');
  if (!capture) return null;
  const indexes = reference.wordIndexes;
  if (!indexes.length || new Set(indexes).size !== indexes.length || indexes.some((index, position) => index >= observation.ocrWords!.length || (position > 0 && index <= indexes[position - 1]))) return null;
  const words = indexes.map(index => observation.ocrWords![index]);
  if (words.some((word, index) => word.wordIndex !== indexes[index] || !word.text.trim() || word.bbox.x1 <= word.bbox.x0 || word.bbox.y1 <= word.bbox.y0)) return null;
  if (words.some(word => word.bbox.x1 > capture.preparedImage.width || word.bbox.y1 > capture.preparedImage.height)) return null;
  const quote = candidate.supportingSpans.find(span => span.kind === 'observation' && span.id === observation.id)?.quote;
  if (!quote || !observation.text.includes(quote) || words.some(word => !quote.toLocaleLowerCase('en-IN').includes(word.text.toLocaleLowerCase('en-IN')))) return null;
  const box = {
    x0: Math.min(...words.map(word => word.bbox.x0)),
    y0: Math.min(...words.map(word => word.bbox.y0)),
    x1: Math.max(...words.map(word => word.bbox.x1)),
    y1: Math.max(...words.map(word => word.bbox.y1)),
  };
  return {
    observation,
    words,
    text: words.map(word => word.text).join(' '),
    box,
    imageWidth: capture.preparedImage.width,
    imageHeight: capture.preparedImage.height,
    imageId: observation.imageId,
    runId: observation.readingOrder.runId,
  };
}

function center(box: RoleEvidence['box']) {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

function rowAligned(a: RoleEvidence, b: RoleEvidence): boolean {
  if (a.imageId !== b.imageId || a.runId !== b.runId || a.imageHeight !== b.imageHeight) return false;
  const first = center(a.box), second = center(b.box);
  return Math.abs(first.y - second.y) <= Math.max(a.imageHeight * 0.015, first.height * 0.75, second.height * 0.75, 2);
}

function columnAligned(a: RoleEvidence, b: RoleEvidence): boolean {
  if (a.imageId !== b.imageId || a.runId !== b.runId || a.imageWidth !== b.imageWidth) return false;
  const first = center(a.box), second = center(b.box);
  return Math.abs(first.x - second.x) <= Math.max(a.imageWidth * 0.075, (first.width + second.width) / 2);
}

function parsePrintedNumber(text: string): number | null {
  const compact = text.replace(/\s+/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(compact)) return null;
  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

function normalizedUnit(text: string, expected: string, key: NutrientKey): string | null {
  const token = text.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^a-z]/g, '');
  const normalized = expected.toLocaleLowerCase('en-IN');
  const supported = key === 'energy' ? ['kcal', 'kj'] : key === 'sodium' || key === 'salt' ? ['g', 'mg'] : ['g'];
  if (!supported.includes(normalized) || token !== normalized) return null;
  return normalized === 'kj' ? 'kJ' : normalized;
}

function basisMatches(text: string, basis: NonNullable<TentativeStructuredCandidate['basis']>): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en-IN');
  const matches = [...normalized.matchAll(/(?:\bper\s*)?(?:(?:serve|serving)\s*)?(\d+(?:\.\d+)?)\s*(g|ml)\b/giu)];
  return matches.length === 1 && close(Number(matches[0][1]), basis.amount) && matches[0][2].toLocaleLowerCase('en-IN') === basis.unit;
}

function candidateKey(candidate: TentativeStructuredCandidate): NutrientKey | null {
  const field = nutrientKey(candidate.field);
  const normalized = nutrientKey(candidate.normalizedEntity);
  if (!field || (candidate.normalizedEntity && normalized !== field)) return null;
  return field;
}

function visualReadingEvidence(candidate: TentativeStructuredCandidate, key: NutrientKey, attachedImageIds: Set<string>): { imageIds: string[]; basisDescription: string } | null {
  const references = candidate.visualEvidence ?? [];
  if (!references.length || references.some(reference => !attachedImageIds.has(reference.imageId) || !reference.region)) return null;
  const byImage = new Map<string, string[]>();
  for (const reference of references) byImage.set(reference.imageId, [...(byImage.get(reference.imageId) ?? []), reference.visibleText]);

  const numberUnitPattern = /(?:^|[^\p{L}\p{N}])([0-9]+(?:[.,][0-9]+)?)\s*(kcal|kj|mg|g|ml)(?=$|[^\p{L}])/giu;
  const hasExactValueAndUnit = (text: string) => [...text.matchAll(numberUnitPattern)].some(match =>
    close(Number(match[1].replace(',', '.')), candidate.numericValue!) && match[2].toLocaleLowerCase('en-IN') === candidate.unit!.toLocaleLowerCase('en-IN'));
  const rowImageIds = [...byImage.entries()].filter(([, texts]) => {
    const text = texts.join(' ');
    return labels[key].some(label => {
      const normalizedLabel = normalizedText(label);
      return ` ${normalizedText(text)} `.includes(` ${normalizedLabel} `);
    }) && hasExactValueAndUnit(text);
  }).map(([imageId]) => imageId);
  if (!rowImageIds.length || !candidate.basis || !candidate.unit || candidate.numericValue === null) return null;

  const evidenceText = [...byImage.values()].flat().join(' ');
  const basisAmountPattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${candidate.basis.amount.toString().replace('.', '[.,]')}\\s*${candidate.basis.unit}(?=$|[^\\p{L}])`, 'iu');
  const hasBasisAmount = basisAmountPattern.test(evidenceText);
  const basisAmount = candidate.basis.amount;
  const isPerHundred = basisAmount === 100 && new RegExp(`\\bper\\s*100\\s*${candidate.basis.unit}\\b`, 'iu').test(evidenceText);
  const hasServingBasis = /\bper\s*(?:serve|serving)\b/i.test(evidenceText) && hasBasisAmount;
  if (!isPerHundred && !hasServingBasis) return null;

  return {
    imageIds: [...new Set([...rowImageIds, ...references.map(reference => reference.imageId)])],
    basisDescription: isPerHundred ? `Per 100 ${candidate.basis.unit} (Gemini photo interpretation)` : `${candidate.basis.description} (Gemini photo interpretation)`,
  };
}

function validateCandidate(pkg: PackageData, candidate: TentativeStructuredCandidate, attachedImageIds: Set<string>): { reading?: InterpretedNutrientReading; key: NutrientKey | null; reason?: string } {
  const key = candidateKey(candidate);
  if (candidate.kind !== 'nutrient' || !key) return { key, reason: 'The model did not identify a supported nutrient row.' };
  if (candidate.numericValue === null || !candidate.unit || !candidate.basis) return { key, reason: 'A numeric value, printed unit, or serving basis is unresolved.' };
  const candidateObservations = candidate.observationIds.map(id => pkg.observations.find(item => item.id === id));
  if (candidateObservations.some(item => !item || item.origin !== 'ocr' || item.field !== 'ocr-line')) return { key, reason: 'The candidate does not point only to retained raw OCR lines.' };
  const evidence = {
    label: wordsForRole(pkg, candidate, 'label'),
    value: wordsForRole(pkg, candidate, 'value'),
    unit: wordsForRole(pkg, candidate, 'unit'),
    basis: wordsForRole(pkg, candidate, 'basis'),
  };
  if (!evidence.label || !evidence.value || !evidence.unit || !evidence.basis) {
    const visual = visualReadingEvidence(candidate, key, attachedImageIds);
    if (!visual) return { key, reason: 'The label, exact value and unit, and printed column or serving basis are not all linked to exact OCR words or an attached photo region.' };
    return {
      key,
      reading: {
        key,
        value: candidate.numericValue,
        unit: candidate.unit,
        basis: { ...candidate.basis, description: visual.basisDescription },
        candidateIds: [candidate.candidateId],
        observationIds: [...new Set(candidate.observationIds)],
        imageIds: visual.imageIds,
        uncertainty: candidate.uncertainty,
      },
    };
  }
  const roles = Object.values(evidence) as RoleEvidence[];
  if (roles.some(item => item.imageId !== evidence.value!.imageId || item.runId !== evidence.value!.runId)) return { key, reason: 'The evidence roles come from different photos or OCR runs.' };
  if (!candidateObservations.every(item => item!.imageId === evidence.value!.imageId && item!.readingOrder?.runId === evidence.value!.runId)) return { key, reason: 'The supporting lines span multiple photos or OCR runs.' };
  if (!labelMatches(evidence.label.text, key)) return { key, reason: 'The selected printed label does not match the proposed nutrient.' };
  const printedValue = parsePrintedNumber(evidence.value.words.map(word => word.text).join(''));
  if (printedValue === null || !close(printedValue, candidate.numericValue)) return { key, reason: 'The proposed number does not exactly match the selected OCR number.' };
  const unit = normalizedUnit(evidence.unit.text, candidate.unit, key);
  if (!unit) return { key, reason: 'The proposed unit does not exactly match a supported unit in the selected OCR words.' };
  if (!basisMatches(evidence.basis.text, candidate.basis)) return { key, reason: 'The proposed serving basis does not exactly match the selected OCR words.' };
  if (!rowAligned(evidence.label, evidence.value) || !rowAligned(evidence.unit, evidence.value)) return { key, reason: 'The nutrient label, value and unit do not align on the same printed row.' };
  if (!columnAligned(evidence.basis, evidence.value)) return { key, reason: 'The printed basis does not align with the value column.' };

  return {
    key,
    reading: {
      key,
      value: candidate.numericValue,
      unit,
      basis: { ...candidate.basis, description: evidence.basis.text },
      candidateIds: [candidate.candidateId],
      observationIds: [...new Set(candidate.observationIds)],
      imageIds: [],
      uncertainty: candidate.uncertainty,
    },
  };
}

function normalizedAmount(key: NutrientKey, value: number, unit: string): { value: number; unit: string } | null {
  if (key === 'energy' && (unit === 'kcal' || unit === 'kJ')) return { value: unit === 'kJ' ? value / 4.184 : value, unit: 'kcal' };
  if ((key === 'sodium' || key === 'salt') && (unit === 'mg' || unit === 'g')) return { value: unit === 'g' ? value * 1000 : value, unit: 'mg' };
  if (key !== 'energy' && key !== 'sodium' && key !== 'salt' && (unit === 'mg' || unit === 'g')) return { value: unit === 'mg' ? value / 1000 : value, unit: 'g' };
  return null;
}

function comparable(a: InterpretedNutrientReading, b: InterpretedNutrientReading): boolean {
  if (a.basis.unit !== b.basis.unit) return false;
  const first = normalizedAmount(a.key, a.value, a.unit), second = normalizedAmount(b.key, b.value, b.unit);
  if (!first || !second || first.unit !== second.unit) return false;
  const firstPerUnit = first.value / a.basis.amount;
  const secondPerUnit = second.value / b.basis.amount;
  return Math.abs(firstPerUnit - secondPerUnit) <= Math.max(0.000001, Math.abs(firstPerUnit) * 0.02);
}

/**
 * Keeps model readings separate from package facts. A reading is eligible for
 * arithmetic only when all four roles match exact OCR words and their geometry
 * identifies one row and column. Cross-reader or image-only guesses remain out.
 */
export function reconcileInterpretedNutrition(pkg: PackageData, candidates: TentativeStructuredCandidate[], attachedImageIds: string[] = []): InterpretedNutrition {
  const valid: InterpretedNutrientReading[] = [];
  const withheld: WithheldNutrientInterpretation[] = [];
  for (const candidate of candidates.slice(0, 20)) {
    const result = validateCandidate(pkg, candidate, new Set(attachedImageIds));
    if (result.reading) valid.push(result.reading);
    else if (candidate.kind === 'nutrient') withheld.push({ candidateId: candidate.candidateId, key: result.key, observationIds: candidate.observationIds, reason: result.reason ?? 'The candidate could not be reconciled with the OCR evidence.' });
  }

  const readings: InterpretedNutrientReading[] = [];
  for (const key of nutrientKeys) {
    const group = valid.filter(item => item.key === key);
    if (!group.length) continue;
    if (group.some((reading, index) => group.slice(index + 1).some(other => !comparable(reading, other)))) {
      for (const reading of group) for (const candidateId of reading.candidateIds) withheld.push({ candidateId, key, observationIds: reading.observationIds, reason: 'Model interpretations disagree across values, units, or printed bases; none is used for calculation.' });
      continue;
    }
    const byBasis = new Map<string, InterpretedNutrientReading>();
    for (const reading of group) {
      const signature = `${reading.basis.amount}:${reading.basis.unit}:${reading.value}:${reading.unit}`;
      const existing = byBasis.get(signature);
      if (!existing) byBasis.set(signature, { ...reading });
      else {
        existing.candidateIds = [...new Set([...existing.candidateIds, ...reading.candidateIds])];
        existing.observationIds = [...new Set([...existing.observationIds, ...reading.observationIds])];
        existing.imageIds = [...new Set([...existing.imageIds, ...reading.imageIds])];
      }
    }
    readings.push(...byBasis.values());
  }
  return { readings, withheld };
}

/** Converts a complete evidence-linked candidate into the shared numeric unit. */
export function normalizedInterpretedAmount(reading: InterpretedNutrientReading): { value: number; unit: string } | null {
  return normalizedAmount(reading.key, reading.value, reading.unit);
}

/** Compare a model candidate with any already-parsed package row before use. */
export function matchesPackageRows(reading: InterpretedNutrientReading, rows: Nutrient[]): boolean {
  if (rows.some(row => row.status === 'corrected')) return false;
  // A complete, currently attached photo interpretation can resolve an OCR
  // conflict without erasing it. Keep the package rows untouched and expose
  // the resulting arithmetic as unverified model-derived context.
  if (reading.imageIds.length) return true;
  if (rows.some(row => row.status === 'conflict')) return false;
  if (!rows.length) return true;
  const interpreted = normalizedInterpretedAmount(reading);
  if (!interpreted) return false;
  return rows.every(row => {
    const parsed = normalizedAmount(reading.key, row.value, row.unit);
    if (!parsed || parsed.unit !== interpreted.unit || Math.abs(parsed.value - interpreted.value) > Math.max(0.000001, Math.abs(interpreted.value) * 0.02)) return false;
    if (!row.basis) return true;
    if (row.basis.unit !== reading.basis.unit) return false;
    const parsedPerUnit = parsed.value / row.basis.amount;
    const interpretedPerUnit = interpreted.value / reading.basis.amount;
    return Math.abs(parsedPerUnit - interpretedPerUnit) <= Math.max(0.000001, Math.abs(interpretedPerUnit) * 0.02);
  });
}
