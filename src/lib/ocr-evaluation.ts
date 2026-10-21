import {
  ocrEvaluationReceiptSchema,
  ocrStageSchema,
  type OcrAnnotatedDataset,
  type OcrDatasetField,
  type OcrEvaluationReceipt,
  type OcrExtraction,
  type OcrStage
} from './contracts';

export type OcrEvaluationOptions = {
  experimentId: string;
  datasetVersion: string;
  runAt: string;
  preprocessing: string;
};

export function assertOcrDatasetSemantics(dataset: OcrAnnotatedDataset): void {
  const failures: string[] = [];
  const imageIds = new Set<string>();
  const splitByProduct = new Map<string,string>();
  for (const record of dataset.records) {
    if (imageIds.has(record.imageId)) failures.push(`duplicate image ID ${record.imageId}`);
    imageIds.add(record.imageId);
    const priorSplit = splitByProduct.get(record.productGroupId);
    if (priorSplit && priorSplit !== record.split) failures.push(`product group ${record.productGroupId} crosses dataset splits`);
    splitByProduct.set(record.productGroupId,record.split);

    const regions = new Map<string,string>();
    for (const region of record.annotations.tableRegions) {
      if (regions.has(region.regionId)) failures.push(`duplicate region ID ${record.imageId}/${region.regionId}`);
      regions.set(region.regionId,region.role);
    }
    const fieldIds = new Set<string>();
    for (const field of record.annotations.nutrients) {
      if (fieldIds.has(field.fieldId)) failures.push(`duplicate field ID ${record.imageId}/${field.fieldId}`);
      fieldIds.add(field.fieldId);
      if (field.status === 'clear' && (field.numericValue === null || field.unit === null || field.basis === null)) {
        failures.push(`clear field ${record.imageId}/${field.fieldId} is missing a numeric value, unit or basis`);
      }
      const requiredRoles: Array<[string | null,string]> = [
        [field.labelRegionId,'label'],[field.valueRegionId,'value'],[field.rowRegionId,'row'],
        [field.unitRegionId,'unit'],[field.basisRegionId,'basis']
      ];
      for (const [regionId,role] of requiredRoles) {
        if (regionId && regions.get(regionId) !== role) failures.push(`field ${record.imageId}/${field.fieldId} has an invalid ${role} region reference`);
      }
      if (record.annotations.review.referenceStatus === 'human-verified' && field.status === 'clear' &&
          (!field.labelRegionId || !field.valueRegionId || !field.rowRegionId || !field.basisRegionId || !field.columnId || !field.basisText)) {
        failures.push(`human-verified clear field ${record.imageId}/${field.fieldId} lacks label/value/row/column/basis annotation`);
      }
    }
    if (record.annotations.review.referenceStatus === 'human-verified' &&
        (record.annotations.review.annotatorCount < 2 || !record.annotations.review.adjudicated || record.annotations.review.agreementMetric === null)) {
      failures.push(`human-verified record ${record.imageId} requires two readers, adjudication and an agreement metric`);
    }
    if(record.annotations.review.referenceStatus==='human-verified'){
      const provenance=record.annotations.review.adjudication;
      if(!provenance){
        failures.push(`human-verified record ${record.imageId} requires source-pass and field-decision provenance`);
      } else {
        if(provenance.sourcePasses.length!==2||provenance.sourcePasses[0].annotatorCode===provenance.sourcePasses[1].annotatorCode||new Set(provenance.sourcePasses.map(pass=>pass.reader)).size!==2){
          failures.push(`human-verified record ${record.imageId} requires two distinct source passes`);
        }
        if(new Set(provenance.sourcePasses.map(pass=>pass.sha256.toLowerCase())).size!==2){
          failures.push(`human-verified record ${record.imageId} requires distinct source-pass hashes`);
        }
        const decisionIds=provenance.decisions.map(decision=>decision.fieldId);
        if(new Set(decisionIds).size!==decisionIds.length||decisionIds.length!==record.annotations.nutrients.length||record.annotations.nutrients.some(field=>!decisionIds.includes(field.fieldId))){
          failures.push(`human-verified record ${record.imageId} requires one traceable adjudication decision per final field`);
        }
        if(provenance.decisions.some(decision=>decision.readerAFieldId===null&&decision.readerBFieldId===null)){
          failures.push(`human-verified record ${record.imageId} contains an adjudication decision without source-field links`);
        }
        const canonicalRegionIds=provenance.regions.map(region=>region.canonicalRegionId);
        const sourceRegionKeys=provenance.regions.map(region=>`${region.reader}:${region.sourceRegionId}`);
        if(canonicalRegionIds.length!==record.annotations.tableRegions.length||new Set(canonicalRegionIds).size!==canonicalRegionIds.length||new Set(sourceRegionKeys).size!==sourceRegionKeys.length||record.annotations.tableRegions.some(region=>!canonicalRegionIds.includes(region.regionId))){
          failures.push(`human-verified record ${record.imageId} requires one-to-one source-region mappings`);
        }
        const fieldsById=new Map(record.annotations.nutrients.map(field=>[field.fieldId,field]));
        for(const decision of provenance.decisions){
          const field=fieldsById.get(decision.fieldId);
          if(!field)continue;
          if(decision.disposition==='reader-a'&&decision.readerAFieldId===null)failures.push(`human-verified field ${record.imageId}/${field.fieldId} selects reader A without a source field`);
          if(decision.disposition==='reader-b'&&decision.readerBFieldId===null)failures.push(`human-verified field ${record.imageId}/${field.fieldId} selects reader B without a source field`);
          if(decision.disposition==='manual'&&field.status!=='clear')failures.push(`human-verified field ${record.imageId}/${field.fieldId} has a manual disposition but is unresolved`);
          if(decision.disposition==='ambiguous'||decision.disposition==='not-visible'){
            if(field.status!==decision.disposition||(field.printedNumericText??null)!==null||field.numericValue!==null||field.numericOperator!==null||field.unit!==null||field.basis!==null||field.basisText!==null){
              failures.push(`human-verified field ${record.imageId}/${field.fieldId} promotes numeric content from an unresolved disposition`);
            }
          }
        }
      }
    }
  }
  if (failures.length) throw new Error(`OCR dataset semantic validation failed: ${failures.join('; ')}`);
}

const emptyStage = (): OcrStage => ocrStageSchema.parse({
  textRegionDetected: null,
  labelRecognized: null,
  valueRecognized: null,
  rowColumnAssociated: null,
  unitRecognized: null,
  basisRecognized: null,
  parserAccepted: null
});

const sameBasis = (a: OcrDatasetField['basis'], b: OcrExtraction['candidates'][number]['basis']): boolean => {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.amount === b.amount && a.unit === b.unit;
};

const numericMatch = (expected: OcrDatasetField, actual: OcrExtraction['candidates'][number]): boolean => {
  if (expected.numericValue === null || actual.numericValue === null) return false;
  return expected.numericValue === actual.numericValue && (expected.numericOperator ?? 'eq') === (actual.numericOperator ?? 'eq');
};

const boolAccuracy = (correct: number, scored: number): number | null => scored === 0 ? null : correct / scored;

/**
 * Scores a single image without collapsing conflicting candidates. Candidate
 * keys must already be normalized by the engine adapter. A missing field,
 * explicit abstention, wrong basis, and unmatched extra candidate stay distinct.
 */
export function scoreOcrExtraction(
  dataset: OcrAnnotatedDataset,
  image: OcrAnnotatedDataset['records'][number],
  extraction: OcrExtraction,
  options: OcrEvaluationOptions
): OcrEvaluationReceipt {
  const parsedExtraction = extraction;
  assertOcrDatasetSemantics(dataset);
  if (image.image.sha256.toLowerCase() !== parsedExtraction.input.sha256.toLowerCase()) {
    throw new Error('OCR extraction image hash does not match the annotated record');
  }
  if (image.image.width !== parsedExtraction.input.width || image.image.height !== parsedExtraction.input.height) {
    throw new Error('OCR extraction dimensions do not match the annotated record');
  }
  if (image.imageId !== parsedExtraction.input.imageId) throw new Error('OCR extraction image ID does not match the annotated record');
  if (image.productGroupId !== parsedExtraction.input.productGroupId) throw new Error('OCR extraction product group does not match the annotated record');
  if (dataset.records.find(record => record.imageId === image.imageId) !== image) {
    throw new Error('Annotated image record must belong to the supplied dataset');
  }

  const candidates = parsedExtraction.candidates;
  const used = new Set<number>();
  const rows: OcrEvaluationReceipt['fields'] = [];
  let exact = 0;
  let incorrect = 0;
  let omitted = 0;
  let abstained = 0;
  let unscorable = 0;
  let matchedClear = 0;
  let numericCorrect = 0;
  let unitCorrect = 0;
  let basisCorrect = 0;
  let matched = 0;
  let unscorableEmitted = 0;

  for (const expected of image.annotations.nutrients) {
    if (expected.status !== 'clear') {
      unscorable += 1;
      const candidateIndex = chooseCandidate(candidates, expected, used);
      const candidate = candidateIndex === null ? null : candidates[candidateIndex];
      if (candidateIndex !== null) {
        used.add(candidateIndex);
        matched += 1;
        unscorableEmitted += 1;
      }
      const diagnostic = findDiagnostics(parsedExtraction, expected);
      rows.push({
        fieldId: expected.fieldId,
        candidateId: candidate?.candidateId ?? null,
        emitted: candidate ? {key:candidate.key,numericValue:candidate.numericValue,numericOperator:candidate.numericOperator,unit:candidate.unit,basis:candidate.basis} : null,
        outcome: 'unscorable',
        numericExact: null,
        unitExact: null,
        basisExact: null,
        stage: deriveStage(image,expected,candidate,parsedExtraction,diagnostic.parserRejectionCode),
        parserRejectionCode: diagnostic.parserRejectionCode
      });
      continue;
    }

    const candidateIndex = chooseCandidate(candidates, expected, used);
    if (candidateIndex === null) {
      const isAbstained = parsedExtraction.abstentions.some(item => item.key === expected.key && sameBasis(expected.basis, item.basis));
      if (isAbstained) abstained += 1;
      else omitted += 1;
      const diagnostic = findDiagnostics(parsedExtraction, expected);
      rows.push({
        fieldId: expected.fieldId,
        candidateId: null,
        emitted: null,
        outcome: isAbstained ? 'abstained' : 'omitted',
        numericExact: false,
        unitExact: false,
        basisExact: false,
        stage: deriveStage(image,expected,null,parsedExtraction,diagnostic.parserRejectionCode),
        parserRejectionCode: diagnostic.parserRejectionCode
      });
      continue;
    }

    used.add(candidateIndex);
    matched += 1;
    matchedClear += 1;
    const candidate = candidates[candidateIndex];
    const numberExact = numericMatch(expected, candidate);
    const unitExact = expected.unit === candidate.unit;
    const basisExact = sameBasis(expected.basis, candidate.basis);
    const isExact = numberExact && unitExact && basisExact && expected.key === candidate.key;
    if (numberExact) numericCorrect += 1;
    if (unitExact) unitCorrect += 1;
    if (basisExact) basisCorrect += 1;
    if (isExact) exact += 1;
    else incorrect += 1;
    rows.push({
      fieldId: expected.fieldId,
      candidateId: candidate.candidateId,
      emitted: {key:candidate.key,numericValue:candidate.numericValue,numericOperator:candidate.numericOperator,unit:candidate.unit,basis:candidate.basis},
      outcome: isExact ? 'exact' : 'incorrect',
      numericExact: numberExact,
      unitExact,
      basisExact,
      stage: deriveStage(image,expected,candidate,parsedExtraction,null),
      parserRejectionCode: null
    });
  }

  let falsePositives = 0;
  candidates.forEach((candidate, index) => {
    if (used.has(index)) return;
    falsePositives += 1;
    rows.push({
      fieldId: null,
      candidateId: candidate.candidateId,
      emitted: {key:candidate.key,numericValue:candidate.numericValue,numericOperator:candidate.numericOperator,unit:candidate.unit,basis:candidate.basis},
      outcome: 'false-positive',
      numericExact: null,
      unitExact: null,
      basisExact: null,
      stage: emptyStage(),
      parserRejectionCode: null
    });
  });

  const expectedClear = image.annotations.nutrients.filter(field => field.status === 'clear').length;
  const expected = image.annotations.nutrients.length;
  const scoredEmitted = candidates.length - unscorableEmitted;
  const metrics = parsedExtraction.measurements;
  const receipt: OcrEvaluationReceipt = {
    schemaVersion: 2,
    experimentId: options.experimentId,
    datasetVersion: options.datasetVersion,
    runAt: options.runAt,
    split: image.split,
    referenceStatus: image.annotations.review.referenceStatus,
    input: {
      imageId: image.imageId,
      productGroupId: image.productGroupId,
      sha256: image.image.sha256,
      width: image.image.width,
      height: image.image.height,
      preprocessing: options.preprocessing
    },
    engine: parsedExtraction.engine,
    environment: parsedExtraction.environment,
    metrics: {
      ...metrics,
      fieldScoring: {
        expected,
        expectedClear,
        emitted: candidates.length,
        scoredEmitted,
        matched,
        exact,
        incorrect,
        omitted,
        abstained,
        unscorable,
        unscorableEmitted,
        falsePositives,
        exactFieldPrecision:boolAccuracy(exact,scoredEmitted),
        exactFieldRecall:boolAccuracy(exact,expectedClear),
        fieldCoverage:boolAccuracy(matchedClear,expectedClear),
        numericCorrect,
        numericScored:expectedClear,
        numericAccuracy:boolAccuracy(numericCorrect,expectedClear),
        unitCorrect,
        unitScored:expectedClear,
        unitAccuracy:boolAccuracy(unitCorrect,expectedClear),
        basisCorrect,
        basisScored:expectedClear,
        basisAccuracy:boolAccuracy(basisCorrect,expectedClear)
      }
    },
    fields: rows
  };
  return ocrEvaluationReceiptSchema.parse(receipt);
}

function chooseCandidate(
  candidates: OcrExtraction['candidates'],
  expected: OcrDatasetField,
  used: Set<number>
): number | null {
  const sameKey = candidates.map((candidate,index) => ({candidate,index}))
    .filter(({candidate,index}) => !used.has(index) && candidate.key === expected.key);
  if (sameKey.length === 0) return null;
  sameKey.sort((a,b) => {
    const basisDelta = Number(sameBasis(expected.basis,b.candidate.basis)) - Number(sameBasis(expected.basis,a.candidate.basis));
    if (basisDelta !== 0) return basisDelta;
    const numberDelta = Number(numericMatch(expected,b.candidate)) - Number(numericMatch(expected,a.candidate));
    if (numberDelta !== 0) return numberDelta;
    const unitDelta = Number(expected.unit === b.candidate.unit) - Number(expected.unit === a.candidate.unit);
    return unitDelta || a.index - b.index;
  });
  return sameKey[0].index;
}

function findDiagnostics(extraction: OcrExtraction, expected: OcrDatasetField) {
  const exactBasis = extraction.fieldDiagnostics.find(item => item.key === expected.key && sameBasis(expected.basis,item.basis));
  const byKey = exactBasis ?? extraction.fieldDiagnostics.find(item => item.key === expected.key);
  return {parserRejectionCode:byKey?.parserRejectionCode ?? null};
}

function deriveStage(
  image: OcrAnnotatedDataset['records'][number],
  expected: OcrDatasetField,
  candidate: OcrExtraction['candidates'][number] | null,
  extraction: OcrExtraction,
  parserRejectionCode: OcrEvaluationReceipt['fields'][number]['parserRejectionCode']
): OcrStage {
  const regions = image.annotations.tableRegions;
  const predicted = extraction.recognizedRegions;
  const annotationRegion = (regionId: string | null) => regionId ? regions.find(region => region.regionId === regionId) ?? null : null;
  const labelRegion = annotationRegion(expected.labelRegionId);
  const valueRegion = annotationRegion(expected.valueRegionId);
  const rowRegion = annotationRegion(expected.rowRegionId);
  const unitRegion = annotationRegion(expected.unitRegionId);
  const basisRegion = annotationRegion(expected.basisRegionId);
  const hasGeometryReference = Boolean(labelRegion || valueRegion || rowRegion || unitRegion || basisRegion);
  const detected = hasGeometryReference && predicted.some(region => [labelRegion,valueRegion,rowRegion,unitRegion,basisRegion].some(reference => reference && coversReference(reference.polygon,region.polygon)));
  const labelLines = labelRegion ? predicted.filter(region => coversReference(labelRegion.polygon,region.polygon)) : [];
  const valueLines = valueRegion ? predicted.filter(region => coversReference(valueRegion.polygon,region.polygon)) : [];
  const unitLines = unitRegion ? predicted.filter(region => coversReference(unitRegion.polygon,region.polygon)) : [];
  const basisLines = basisRegion ? predicted.filter(region => coversReference(basisRegion.polygon,region.polygon)) : [];
  const valueTextCorrect = valueLines.some(region => textContainsNumber(region.text,expected.numericValue,expected.numericOperator ?? 'eq'));
  const unitTextCorrect = unitLines.some(region => normalizeText(region.text).includes(normalizeText(expected.unit ?? '')));
  const basisTextCorrect = basisLines.some(region => expected.basisText !== null && normalizeText(region.text).includes(normalizeText(expected.basisText)));
  const sourceRegions = candidate ? predicted.filter(region => candidate.sourceRegionIds.includes(region.regionId)) : [];
  const rowColumnExact = Boolean(candidate && candidate.key === expected.key && rowRegion && valueRegion && expected.columnId &&
    valueRegion.columnId === expected.columnId && sourceRegions.some(region => coversReference(rowRegion.polygon,region.polygon) && coversReference(valueRegion.polygon,region.polygon)));
  const diagnostics = findDiagnostics(extraction,expected);
  return ocrStageSchema.parse({
    textRegionDetected:hasGeometryReference ? detected : null,
    labelRecognized:labelRegion ? (labelLines.length ? labelLines.some(region => normalizeText(region.text).includes(normalizeText(expected.labelText))) : detected ? false : null) : candidate ? candidate.key === expected.key : null,
    valueRecognized:expected.numericValue === null ? null : valueRegion ? (valueLines.length ? valueTextCorrect : detected ? false : null) : candidate ? numericMatch(expected,candidate) : null,
    rowColumnAssociated:rowRegion && valueRegion && candidate && sourceRegions.length ? rowColumnExact : null,
    unitRecognized:expected.unit === null ? null : candidate ? candidate.unit === expected.unit : unitRegion ? (unitLines.length ? unitTextCorrect : null) : null,
    basisRecognized:expected.basis === null ? null : candidate ? sameBasis(expected.basis,candidate.basis) : basisRegion ? (basisLines.length ? basisTextCorrect : null) : null,
    parserAccepted:candidate ? true : diagnostics.parserRejectionCode ? false : null
  });
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'');
}

function textContainsNumber(text: string, expected: number | null, operator: OcrDatasetField['numericOperator']): boolean {
  if (expected === null) return false;
  const tokens = text.replace(/,/g,'.').match(/\d+(?:\.\d+)?/g) ?? [];
  const qualifier = operator === null || operator === 'eq'
    ? !/[<>≤≥]/.test(text)
    : operator === 'lt' ? /<(?![=])/.test(text)
    : operator === 'lte' ? /<=|≤/.test(text)
    : operator === 'gt' ? />(?![=])/.test(text)
    : />=|≥/.test(text);
  return tokens.some(token => Number(token) === expected) && qualifier;
}

function bounds(polygon: Array<[number,number]>) {
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  return {left:Math.min(...xs),top:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
}

function coversReference(reference: Array<[number,number]>, detected: Array<[number,number]>): boolean {
  const a = bounds(reference);
  const b = bounds(detected);
  const overlapWidth = Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
  const overlapHeight = Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  const referenceArea = Math.max(0,a.right-a.left) * Math.max(0,a.bottom-a.top);
  return referenceArea > 0 && (overlapWidth * overlapHeight) / referenceArea >= 0.5;
}
