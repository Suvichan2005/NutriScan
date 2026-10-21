import { packageSchema, type Nutrient, type PackageData } from './contracts';

const normalized = (n: Nutrient) => n.value * (n.unit === 'mg' ? 0.001 : n.unit === 'kJ' ? 1 / 4.184 : 1);
const observationSignature = (observation: PackageData['observations'][number]) => observation.imageId
  ? `${observation.imageId}|${observation.field}|${observation.text.trim().toLocaleLowerCase()}`
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

  const observations = [...current.observations];
  const idMap = new Map<string, string>();
  for (const observation of incoming.observations) {
    const signature = observationSignature(observation);
    const existing = signature ? observations.find(o => observationSignature(o) === signature) : undefined;
    if (existing) { idMap.set(observation.id, existing.id); continue; }
    let id = observation.id;
    if (observations.some(o => o.id === id)) id = `merged-${crypto.randomUUID()}`;
    observations.push({ ...observation, id });
    idMap.set(observation.id, id);
  }
  const mergedNutrients = [...current.nutrients];
  for (const n of incoming.nutrients) {
    const candidate = { ...n, observationIds: n.observationIds.map(id => idMap.get(id) ?? id) };
    const duplicate = mergedNutrients.find(old => old.key === candidate.key && old.unit === candidate.unit && old.value === candidate.value && old.basis?.amount === candidate.basis?.amount && old.basis?.unit === candidate.basis?.unit && old.status === candidate.status);
    if (duplicate) duplicate.observationIds = [...new Set([...duplicate.observationIds, ...candidate.observationIds])];
    else mergedNutrients.push(candidate);
  }
  for (const n of mergedNutrients) {
    const comparable = mergedNutrients.filter(other => other !== n && other.key === n.key && other.basis && n.basis && other.basis.unit === n.basis.unit && Math.abs(other.value / other.basis.amount - n.value / n.basis.amount) > 1e-6);
    const disagreement = comparable.some(other => Math.abs(normalized(other) / other.basis!.amount - normalized(n) / n.basis!.amount) > Math.max(1e-6, normalized(n) / n.basis!.amount * 0.02));
    if (disagreement) {
      n.status = 'conflict';
      const warning = `${n.key}: conflicting readings retained across photos; calculation withheld until verified.`;
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }
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
    barcode: current.barcode || incoming.barcode,
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
    rawText,
    warnings: unique(warnings),
    synthetic: current.synthetic && incoming.synthetic,
  });
}
