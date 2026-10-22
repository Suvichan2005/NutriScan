import { packageSchema, type Nutrient, type PackageData, type ParserDiagnostic } from './contracts';

const normalized = (n: Nutrient) => n.value * (n.unit === 'mg' ? 0.001 : n.unit === 'kJ' ? 1 / 4.184 : 1);
function halfDisplayStep(pkg:PackageData,nutrient:Nutrient):number{
  const candidates=(pkg.parserDiagnostics??[]).filter(diagnostic=>diagnostic.field===nutrient.key).flatMap(diagnostic=>diagnostic.numericCandidates);
  const candidate=candidates.find(item=>item.value===nutrient.value&&(!item.unit||item.unit.toLowerCase()===nutrient.unit.toLowerCase()));
  const raw=candidate?.rawValueText??String(nutrient.value);
  const decimalPlaces=raw.match(/[.,](\d+)$/)?.[1].length??0;
  const conversion=nutrient.unit==='mg'?0.001:nutrient.unit==='kJ'?1/4.184:1;
  return (0.5*Math.pow(10,-decimalPlaces))*conversion;
}
const observationSignature = (observation: PackageData['observations'][number]) => observation.imageId
  ? `${observation.imageId}|${observation.field}|${observation.text.trim().toLocaleLowerCase()}${observation.readingOrder?`|${observation.readingOrder.runId}:${observation.readingOrder.lineIndex}`:''}`
  : observation.field === 'user-description' ? `user-description|${observation.text.trim().toLocaleLowerCase()}` : '';

/** Adds a new package read to an investigation without replacing its established state. */
export function mergePackageEvidence(current: PackageData, incoming: PackageData): PackageData {
  const warnings = [...current.warnings, ...incoming.warnings];
  const barcodeMismatch = !!(current.barcode && incoming.barcode && current.barcode !== incoming.barcode);
  if (barcodeMismatch) warnings.push('A newly read barcode differs from the original package. The photos may show different products; verify identity before using combined evidence.');
  const identityMismatches = [
    current.brand && incoming.brand && current.brand.trim().toLocaleLowerCase() !== incoming.brand.trim().toLocaleLowerCase() ? 'brand' : '',
    current.license && incoming.license && current.license !== incoming.license ? 'license number' : '',
  ].filter(Boolean);
  if (identityMismatches.length) warnings.push(`New photo evidence disagrees with the original ${identityMismatches.join(' and ')}. The photos may show different products; verify identity before combining evidence.`);
  const identityConflict = !!current.identityConflict || !!incoming.identityConflict || barcodeMismatch || identityMismatches.length > 0;

  const observations = [...current.observations];
  const idMap = new Map<string, string>();
  for (const observation of incoming.observations) {
    const signature = observationSignature(observation);
    const existing = signature ? observations.find(o => observationSignature(o) === signature) : undefined;
    if (existing) { idMap.set(observation.id, existing.id); continue; }
    let id = observation.id;
    if (observations.some(o => o.id === id)) id = `merged-${crypto.randomUUID()}`;
    observations.push({ ...observation, id,
      ...(observation.derivedFromObservationIds?{derivedFromObservationIds:observation.derivedFromObservationIds.map(sourceId=>idMap.get(sourceId)??sourceId)}:{}),
      ...(observation.supersedesObservationIds?{supersedesObservationIds:observation.supersedesObservationIds.map(sourceId=>idMap.get(sourceId)??sourceId)}:{}),
    });
    idMap.set(observation.id, id);
  }
  const mergedNutrients = [...current.nutrients];
  const nutrientSources=new Map<Nutrient,PackageData>(current.nutrients.map(nutrient=>[nutrient,current]));
  for (const n of incoming.nutrients) {
    const candidate = { ...n, observationIds: n.observationIds.map(id => idMap.get(id) ?? id) };
    const duplicate = mergedNutrients.find(old => old.key === candidate.key && old.unit === candidate.unit && old.value === candidate.value && old.basis?.amount === candidate.basis?.amount && old.basis?.unit === candidate.basis?.unit && old.status === candidate.status);
    if (duplicate) duplicate.observationIds = [...new Set([...duplicate.observationIds, ...candidate.observationIds])];
    else { mergedNutrients.push(candidate); nutrientSources.set(candidate,incoming); }
  }
  for (const n of mergedNutrients) {
    const comparable = mergedNutrients.filter(other => other !== n && other.key === n.key && other.basis && n.basis && other.basis.unit === n.basis.unit && Math.abs(other.value / other.basis.amount - n.value / n.basis.amount) > 1e-6);
    const disagreement = comparable.some(other => {
      const nRate=normalized(n)/n.basis!.amount;
      const otherRate=normalized(other)/other.basis!.amount;
      const roundingTolerance=halfDisplayStep(nutrientSources.get(n)??current,n)/n.basis!.amount+halfDisplayStep(nutrientSources.get(other)??current,other)/other.basis!.amount;
      return Math.abs(otherRate-nRate)>Math.max(1e-6,nRate*0.02,roundingTolerance);
    });
    if (disagreement) {
      n.status = 'conflict';
      const warning = `${n.key}: conflicting readings retained across photos; calculation withheld until verified.`;
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }
  const parserDiagnostics=[
    ...(current.parserDiagnostics??[]),
    ...(incoming.parserDiagnostics??[]).map(diagnostic=>({...diagnostic,
      sourceObservationIds:diagnostic.sourceObservationIds.map(id=>idMap.get(id)??id),
      ...(diagnostic.numericEvidenceObservationIds?{numericEvidenceObservationIds:diagnostic.numericEvidenceObservationIds.map(id=>idMap.get(id)??id)}:{}),
      ...(diagnostic.basisEvidenceObservationIds?{basisEvidenceObservationIds:diagnostic.basisEvidenceObservationIds.map(id=>idMap.get(id)??id)}:{}),
    })),
  ];
  for(const diagnostic of parserDiagnostics){
    const rowObservationId=diagnostic.sourceObservationIds[0];
    const conflict=mergedNutrients.some(nutrient=>nutrient.key===diagnostic.field&&nutrient.status==='conflict'&&nutrient.observationIds.includes(rowObservationId));
    if(conflict&&diagnostic.decision==='accepted'){
      diagnostic.decision='conflict';
      diagnostic.reasonCodes=Array.from(new Set<ParserDiagnostic['reasonCodes'][number]>([...diagnostic.reasonCodes,'cross-reading-conflict']));
    }
  }
  const ocrCaptures=[...(current.ocrCaptures??[]),...(incoming.ocrCaptures??[])].filter((capture,index,captures)=>captures.findIndex(item=>item.runId===capture.runId)===index);
  const incomingHasOcr = incoming.observations.some(observation => observation.origin === 'ocr');
  const sectionTitle = incomingHasOcr ? 'Additional photo evidence' : 'Additional user-entered label text';
  const rawText = `${current.rawText}${current.rawText && incoming.rawText ? `\n\n--- ${sectionTitle} ---\n` : ''}${incoming.rawText}`.slice(0, 40000);
  if (current.rawText.length + incoming.rawText.length > rawText.length) warnings.push('Combined label text reached the 40,000-character storage limit; later text was truncated.');
  if (mergedNutrients.length) {
    const noValues = 'No usable nutrition values were extracted. Missing values are unknown, not zero.';
    const idx = warnings.indexOf(noValues); if (idx >= 0) warnings.splice(idx, 1);
  }
  const unique = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))];
  return packageSchema.parse({
    ...current,
    name: current.name === 'Unidentified package' && incoming.name !== 'Unidentified package' ? incoming.name : current.name,
    brand: current.brand || incoming.brand,
    barcode: identityConflict ? undefined : current.barcode || incoming.barcode,
    identityConflict,
    userDescription: [...new Set([current.userDescription, incoming.userDescription].filter((value): value is string => !!value))].join('\n').slice(0, 4000) || undefined,
    license: current.license || incoming.license,
    serving: current.serving || incoming.serving,
    netWeight: current.netWeight || incoming.netWeight,
    ingredients: unique([...current.ingredients, ...incoming.ingredients]),
    additives: unique([...current.additives, ...incoming.additives]),
    allergens: unique([...current.allergens, ...incoming.allergens]),
    claims: unique([...current.claims, ...incoming.claims]),
    nutrients: mergedNutrients,
    observations,
    ...(ocrCaptures.length?{ocrCaptures}:{}),
    ...(parserDiagnostics.length?{parserDiagnostics}:{}),
    rawText,
    warnings: unique(warnings),
    synthetic: current.synthetic && incoming.synthetic,
  });
}

/** Keeps an already usable primary field when a secondary reader has only an unbased candidate. */
export function mergeSecondaryOcrEvidence(primary: PackageData, secondary: PackageData): PackageData {
  const primaryUsableKeys = new Set(primary.nutrients
    .filter(nutrient => nutrient.status === 'observed' && nutrient.basis)
    .map(nutrient => nutrient.key));
  const usableSecondary = secondary.nutrients.filter(nutrient => nutrient.status === 'observed' && nutrient.basis);
  const sourceImageIds = (pkg: PackageData, nutrient: Nutrient) => new Set(nutrient.observationIds.flatMap(id => {
    const observation = pkg.observations.find(item => item.id === id);
    const sourceIds = observation?.derivedFromObservationIds ?? [id];
    return pkg.observations.filter(item => sourceIds.includes(item.id) && item.origin === 'ocr' && item.field === 'ocr-line' && item.imageId).map(item => item.imageId!);
  }));
  const sharedImage = (first: Nutrient, second: Nutrient) => {
    const firstImages = sourceImageIds(primary, first);
    return [...sourceImageIds(secondary, second)].some(imageId => firstImages.has(imageId));
  };

  // Matching OCR values on the same photo let a based secondary reading
  // resolve the first reader's missing basis without discarding its evidence.
  const corroboratedUnbased = primary.nutrients.filter(candidate => candidate.status === 'observed' && !candidate.basis
    && usableSecondary.some(reading => reading.key === candidate.key && reading.unit === candidate.unit && reading.value === candidate.value && sharedImage(candidate, reading)));
  const remainingPrimary = primary.nutrients.filter(nutrient => !corroboratedUnbased.includes(nutrient));
  const primaryForMerge = corroboratedUnbased.length ? { ...primary, nutrients: remainingPrimary } : primary;
  const supportedCandidates = secondary.nutrients
    .filter(nutrient => !primaryUsableKeys.has(nutrient.key) || nutrient.basis !== null)
    .map(nutrient => {
      const corroboratingIds = corroboratedUnbased.filter(candidate => candidate.key === nutrient.key && candidate.unit === nutrient.unit && candidate.value === nutrient.value && sharedImage(candidate, nutrient)).flatMap(candidate => candidate.observationIds);
      return corroboratingIds.length ? { ...nutrient, observationIds: [...new Set([...nutrient.observationIds, ...corroboratingIds])] } : nutrient;
    });
  return mergePackageEvidence(primaryForMerge, { ...secondary, nutrients: supportedCandidates });
}
