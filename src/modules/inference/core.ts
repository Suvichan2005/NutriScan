import {
  calculationEvidenceText,
  type Calculation,
  type EvidenceSource,
  type PackageData,
  type PackageReconstructionContent,
  type Profile,
} from '../../lib/contracts';
import { InferenceModuleError } from './errors';
import { assistOutput } from './schema';
import { calculationRespectsCorrections, reconstructionRowIsSuperseded } from '../../lib/correction';

export type AssistValidationContext = {
  package: PackageData;
  question?: string;
  evidence?: EvidenceSource[];
  calculations?: Calculation[];
  profile?: Profile;
  images?: { handle: string }[];
  diagnostic?: (event: { stage: 'claim' | 'answer-part' | 'natural-answer' | 'structured-answer' | 'candidate' | 'ui' | 'image-action'; index: number; decision: 'accepted' | 'rejected'; reason?: string }) => void;
};

type PackageReconstructionFact = { id: string; text: string };

/**
 * Expose non-nutrient reconstructed package details as stable, validated
 * evidence references. These facts remain provisional when derived from a
 * photo, and never replace the original observations or saved source lineage.
 */
export function packageReconstructionFactReferences(
  reconstruction: PackageData['reconstruction'] | PackageReconstructionContent | undefined,
  pkg: PackageData,
  requestImageIds: readonly string[] = [],
): PackageReconstructionFact[] {
  if (!reconstruction) return [];
  const observations = new Set(pkg.observations.map(item => item.id));
  const images = new Set([
    ...pkg.observations.flatMap(item => item.imageId ? [item.imageId] : []),
    ...(pkg.ocrCaptures ?? []).map(item => item.imageId),
    ...(pkg.visionCaptures ?? []).map(item => item.imageId),
    ...requestImageIds,
  ]);
  const statusUsable = (status: string) => status === 'clear' || status === 'provisional';
  const traceable = (evidence: { observationIds: string[]; imageRegions: { imageId: string }[] }) =>
    evidence.observationIds.some(id => observations.has(id))
    || evidence.imageRegions.some(region => images.has(region.imageId));
  const facts: PackageReconstructionFact[] = [];
  const add = (id: string, text: string, status: string, evidence: { observationIds: string[]; imageRegions: { imageId: string }[] }) => {
    if (statusUsable(status) && traceable(evidence) && text.trim()) facts.push({ id: `package-fact:${id}`, text: text.trim().slice(0, 1600) });
  };

  const identity = reconstruction.identity;
  const identityParts = [identity.brand, identity.name, identity.variant].filter((part): part is string => !!part?.trim());
  if (identityParts.length) add('identity', `Reconstructed package identity: ${identityParts.join(' ')}.`, identity.status, identity.evidence);

  const serving = reconstruction.serving;
  if (serving) {
    const details = [serving.printedText, serving.quantity !== null && serving.unit ? `${serving.quantity} ${serving.unit}` : null,
      serving.pieceCount !== null ? `${serving.pieceCount} ${serving.pieceDescription ?? 'pieces'}` : null].filter((part): part is string => !!part?.trim());
    if (details.length) add('serving', `Reconstructed serving declaration: ${[...new Set(details)].join('; ')}.`, serving.status, serving.evidence);
  }

  (reconstruction.quantityDeclarations??[]).forEach((item,index)=>{
    const kind=item.kind==='net-content'?'net package contents':item.kind==='unit-count'?'number of physical units in the package':'servings per package';
    const quantity=item.quantity!==null&&item.unit?`${item.quantity} ${item.unit}`:null;
    const detail=[item.printedText,quantity].filter((part):part is string=>!!part?.trim());
    if(detail.length)add(`quantity:${index}`,`Reconstructed ${kind}: ${[...new Set(detail)].join('; ')}.`,item.status,item.evidence);
  });

  reconstruction.ingredients.forEach((item, index) => {
    const text = [`Ingredient ${index + 1}: ${item.name}.`, item.printedText ? `Printed wording: ${item.printedText}.` : null,
      item.printedPercentage !== null ? `Printed percentage: ${item.printedPercentage}%.` : null].filter(Boolean).join(' ');
    add(`ingredient:${index}`, text, item.status, item.evidence);
  });
  reconstruction.additives.forEach((item, index) => {
    add(`additive:${index}`, `Package additive: ${item.printedName}${item.code ? ` (${item.code})` : ''}${item.normalizedName && item.normalizedName !== item.printedName ? `; normalized as ${item.normalizedName}` : ''}.`, item.status, item.evidence);
  });
  reconstruction.statements.forEach((item, index) => {
    add(`statement:${index}`, `Package ${item.kind}${item.label ? ` (${item.label})` : ''}: ${item.text}`, item.status, item.evidence);
  });
  return facts;
}

function fail(code: ConstructorParameters<typeof InferenceModuleError>[0], message: string): never {
  throw new InferenceModuleError(code, message);
}

function normalizeLabelText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Check only source identity: relevance is semantic work for the model, not this adapter. */
function namedSourceHasReference(
  text: string,
  sourceIds: readonly string[],
  evidence: readonly Pick<EvidenceSource, 'id' | 'title' | 'publisher'>[],
): boolean {
  const normalizedText = ` ${normalizeLabelText(text)} `;
  const linked = new Set(sourceIds);
  return evidence.every(source => {
    const publisher = normalizeLabelText(source.publisher);
    const title = normalizeLabelText(source.title);
    const acronym = (source.publisher.match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(word => word[0]).join('').toLocaleUpperCase();
    const explicitlyNamed = (publisher.length >= 8 && normalizedText.includes(` ${publisher} `))
      || (title.split(' ').filter(word => word.length > 3).length >= 3 && normalizedText.includes(` ${title} `))
      || (acronym.length >= 2 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${acronym}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text));
    return !explicitlyNamed || linked.has(source.id);
  });
}

function claimNamesReconstructedNutrient(claim: string, row: { nutrient: string; printedLabel: string }): boolean {
  const label = normalizeLabelText(`${row.nutrient} ${row.printedLabel}`);
  const text = normalizeLabelText(claim);
  const families: Array<[RegExp, RegExp]> = [
    [/added sugars?/, /\badded sugars?\b/],
    [/trans fat(?:ty acids?)?/, /\btrans\s+fat(?:ty\s+acids?)?\b/],
    [/saturated fat/, /\bsaturated fat\b/],
    [/carbohydrates?|carbs?/, /\b(?:carbohydrates?|carbs?)\b/],
    [/total sugars?|sugars?/, /\b(?:total sugars?|sugars?)\b/],
    [/protein/, /\bprotein\b/],
    [/total fat|fat/, /\b(?:total fat|fat)\b/],
    [/fibre|fiber/, /\b(?:fibre|fiber)\b/],
    [/sodium/, /\bsodium\b/],
    [/salt/, /\bsalt\b/],
    [/cholesterol/, /\bcholesterol\b/],
    [/iron/, /\biron\b/],
    [/calcium/, /\bcalcium\b/],
    [/potassium/, /\bpotassium\b/],
    [/energy|calories?/, /\b(?:energy|calories?)\b/],
  ];
  const family = families.find(([rowPattern]) => rowPattern.test(label));
  if (family) return family[1].test(text);
  const meaningfulWords = label.split(' ').filter(word => word.length > 2 && !['total', 'amount', 'label'].includes(word));
  return meaningfulWords.length > 0 && meaningfulWords.every(word => text.split(' ').includes(word));
}

function namedNutritionFamilies(text:string):string[]{
  const patterns:Array<[string,RegExp]>=[
    ['added-sugars',/\badded sugars?\b/i],['saturated-fat',/\bsaturat\w* fat\b/i],
    ['trans-fat',/\btrans\s+fat(?:ty\s+acids?)?\b/i],
    ['carbohydrate',/\b(?:carbohydrat\w*|carbs?)\b/i],['sugars',/\btotal sugars?\b|(?<!added )\bsugars?\b/i],
    ['protein',/\b(?:protein|proten)\b/i],['fat',/\btotal fat\b|(?<!saturated )(?<!trans )\bfat\b/i],['fiber',/\b(?:fibre|fiber)\b/i],
    ['sodium',/\bsodium\b/i],['salt',/\bsalt\b/i],['cholesterol',/\bcholesterol\b/i],
    ['iron',/\biron\b/i],['calcium',/\bcalcium\b/i],['potassium',/\bpotassium\b/i],
    ['energy',/\b(?:energy|calories?|kcal|kilojoules?|kj)\b/i],
  ];
  return patterns.filter(([,pattern])=>pattern.test(text)).map(([family])=>family);
}

function claimNamesAnyNutrient(claim: string): boolean {
  return /\b(?:carbohydrat\w*|carbs?|protein|proten|trans\s+fat|fat|saturat\w*\s+fat|sugars?|sodium|salt|cholesterol|iron|calcium|potassium|fibre|fiber|energy|kcal|kilojoules?)\b/i.test(claim);
}

function numericToken(value: number): string {
  return String(value).replace('.', '[.,]');
}

function quantityWithUnitAppears(text: string, value: number, unit: string, basis = false): boolean {
  const unitPattern = ({
    g: '(?:g|grams?)', mg: '(?:mg|milligrams?)', kcal: '(?:kcal|kilocalories?)',
    kj: '(?:kj|kilojoules?)', ml: '(?:ml|millilit(?:er|re)s?)',
  } as Record<string, string>)[unit.toLocaleLowerCase()];
  if (!unitPattern) return false;
  const quantity = `${numericToken(value)}\\s*${unitPattern}\\b`;
  return new RegExp(basis ? `\\bper\\s+${quantity}` : `(?:^|[^\\d.,])${quantity}`, 'i').test(text);
}

function conflictsWithReconstructedNutrientAssociation(claim: { text: string; observationIds: string[] }, rows: Array<{
  nutrient: string; printedLabel: string; value: number | null; unit: string | null; basisAmount: number | null;
  basisUnit: string | null; status: string; evidence: { observationIds: string[] };
}>): boolean {
  if (!claim.observationIds.length || !claimNamesAnyNutrient(claim.text)) return false;
  const sameEvidenceRows = rows.filter(row => ['clear', 'provisional'].includes(row.status)
    && row.value !== null && row.unit && row.basisAmount !== null && row.basisUnit
    && claim.observationIds.some(id => row.evidence.observationIds.includes(id))
    && quantityWithUnitAppears(claim.text, row.value, row.unit)
    && quantityWithUnitAppears(claim.text, row.basisAmount, row.basisUnit, true));
  return sameEvidenceRows.length > 0 && !sameEvidenceRows.some(row => claimNamesReconstructedNutrient(claim.text, row));
}

/** Validate and safely render model output without invoking a provider. */
export function validateInferenceOutput(output: unknown, data: AssistValidationContext) {
  const result = assistOutput.safeParse(output);
  if (!result.success) {
    if (process.env.NODE_ENV !== 'production') {
      // Keep local provider debugging useful without ever logging generated text,
      // evidence, profile context, images, or prompt contents.
      console.warn('Gemini structured-output validation rejected fields', {
        issueCount: result.error.issues.length,
        issues: result.error.issues.slice(0, 20).map(issue => ({
          code: issue.code,
          field: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').join('.'),
        })),
      });
    }
    fail('provider_invalid', 'The model output failed validation. No result was accepted.');
  }

  const observations = new Map(data.package.observations.map(observation => [observation.id, observation.text]));
  const webGroundingSourceIds = new Set((data.evidence ?? []).filter(source => source.category === 'web-search').map(source => source.id));
  // Source limitations are attributable evidence too. A model must be able to
  // cite the record's own scope caveat rather than making it an unsupported
  // disclaimer that the exact-span validator silently drops.
  const sources = new Map((data.evidence ?? []).map(source => [source.id, `${source.summary}\n${source.limitations}`]));
  const calculations = new Map((data.calculations ?? []).map(calculation => [
    calculation.id,
    // evidenceText is a legacy presentation cache and can be stale after a
    // deployed wording change. Build validation evidence only from typed,
    // arithmetic-checked fields linked to the current package.
    calculationEvidenceText(calculation),
  ]));
  const calculationsById = new Map((data.calculations ?? []).map(calculation=>[calculation.id,calculation]));
  const profileFields = new Map(Object.entries(data.profile ?? {}).filter(([, value]) => value.trim().length > 0));
  const imageIds = new Set((data.images ?? []).map(image => image.handle));
  // A saved interpretation keeps its original photo lineage. That lineage can
  // support a follow-up without transmitting the same photo again. New direct
  // visual claims still require bytes attached to this request (imageIds).
  const retainedPackageImageIds = new Set([
    ...imageIds,
    ...data.package.observations.flatMap(observation => observation.imageId ? [observation.imageId] : []),
    ...(data.package.ocrCaptures ?? []).map(capture => capture.imageId),
    ...(data.package.visionCaptures ?? []).map(capture => capture.imageId),
  ]);

  const reconstructionRows=result.data.packageReconstruction?.nutritionRows
    ??(data.package.reconstruction?.current?data.package.reconstruction.nutritionRows:[]);
  const reconstructionForUi=result.data.packageReconstruction??(data.package.reconstruction?.current?data.package.reconstruction:undefined);
  const serving=reconstructionForUi?.serving;
  const servingHasEvidence=!!serving&&['clear','provisional'].includes(serving.status)
    &&(serving.evidence.observationIds.some(id=>observations.has(id))
      ||serving.evidence.imageRegions.some(region=>retainedPackageImageIds.has(region.imageId)));
  const servingBasis=serving&&servingHasEvidence&&serving.quantity!==null&&serving.unit
    ?{quantity:serving.quantity,unit:serving.unit}:null;
  const packageFacts = new Map(packageReconstructionFactReferences(
    result.data.packageReconstruction ?? (data.package.reconstruction?.current ? data.package.reconstruction : undefined),
    data.package,
    data.images?.map(image => image.handle),
  ).map(fact => [fact.id, fact.text]));
  const interpretationRows=new Map(reconstructionRows.flatMap(row=>{
    const hasEvidence=row.evidence.observationIds.some(id=>observations.has(id))||row.evidence.imageRegions.some(region=>retainedPackageImageIds.has(region.imageId));
    const printedBasis=[row.columnLabel,row.basisText].filter((value):value is string=>!!value?.trim()).join('; ');
    const hasNumericBasis=row.basisAmount!==null&&!!row.basisUnit;
    if(!hasEvidence||!['clear','provisional'].includes(row.status)||row.value===null||!row.unit||(!hasNumericBasis&&!printedBasis))return [];
    const normalizedBasis=hasNumericBasis?`; per ${row.basisAmount} ${row.basisUnit}`:'';
    const sameAsServing=!!servingBasis&&row.basisAmount===servingBasis.quantity
      &&row.basisUnit?.toLocaleLowerCase()===servingBasis.unit.toLocaleLowerCase();
    const servingAlias=sameAsServing?`; per serving (serving size ${servingBasis.quantity} ${servingBasis.unit})`:'';
    return [[row.rowId,`${row.nutrient} ${row.qualifier?`${row.qualifier} `:''}${row.value} ${row.unit}; ${printedBasis}${normalizedBasis}${servingAlias}`] as const];
  }));
  const traceableRows=reconstructionRows.filter(row=>interpretationRows.has(row.rowId));
  const hasReconstructedIngredients=(reconstructionForUi?.ingredients??[]).some((item,index)=>packageFacts.has(`package-fact:ingredient:${index}`))
    ||(reconstructionForUi?.additives??[]).some((item,index)=>packageFacts.has(`package-fact:additive:${index}`));
  const hasReconstructedStatements=(reconstructionForUi?.statements??[]).some((item,index)=>packageFacts.has(`package-fact:statement:${index}`));
  const supportedByIndex = new Map<number, (typeof result.data.claims)[number] & {supportingSpans:NonNullable<(typeof result.data.claims)[number]['supportingSpans']>}>();
  const supported = result.data.claims.flatMap((originalClaim, claimIndex) => {
    let claim = originalClaim;
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'rejected', reason });
      return [];
    };
    const visualEvidence = claim.visualEvidence ?? [];
    // Package-fact IDs describe optional structured links to the current
    // reconstruction. Gemini can occasionally return a stale index after it
    // omits that fact from the reconstruction. Keep the claim eligible only
    // when it also cites another evidence class; the unavailable package
    // link is removed, and every remaining ID plus numeric/unit/basis rule is
    // still checked below. A dangling package-fact ID alone remains a hard
    // rejection and cannot become its own evidence.
    const unavailablePackageFactIds=(claim.packageFactIds??[]).filter(id=>!packageFacts.has(id));
    const hasIndependentReference=claim.observationIds.length>0||claim.sourceIds.length>0
      ||(claim.calculationIds?.length??0)>0||(claim.interpretationRowIds?.length??0)>0
      ||(claim.profileFieldIds?.length??0)>0||visualEvidence.length>0;
    const droppedUnavailablePackageFacts=unavailablePackageFactIds.length>0&&hasIndependentReference;
    if(droppedUnavailablePackageFacts){
      claim={...claim,packageFactIds:(claim.packageFactIds??[]).filter(id=>packageFacts.has(id))};
    }
    if (!claim.observationIds.length && !claim.sourceIds.length && !(claim.calculationIds?.length) && !(claim.interpretationRowIds?.length) && !(claim.packageFactIds?.length) && !(claim.profileFieldIds?.length) && !visualEvidence.length) return reject('no-evidence-reference');
    if (claim.observationIds.some(id => !observations.has(id))
      || claim.sourceIds.some(id => !sources.has(id))
      || (claim.calculationIds ?? []).some(id => !calculations.has(id))
      || (claim.interpretationRowIds??[]).some(id=>!interpretationRows.has(id))
      || (claim.packageFactIds??[]).some(id=>!packageFacts.has(id))
      || (claim.profileFieldIds ?? []).some(id => !profileFields.has(id))) return reject('unknown-evidence-id');
    if (!namedSourceHasReference(claim.text, claim.sourceIds, data.evidence ?? [])) return reject('named-source-needs-linked-source');
    const citedRows=(claim.interpretationRowIds??[]).map(id=>reconstructionRows.find(row=>row.rowId===id)).filter((row):row is typeof reconstructionRows[number]=>!!row);
    if(citedRows.some(row=>!claimNamesReconstructedNutrient(claim.text,row)))return reject('unsupported-nutrient-association');
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) {
      return reject('unknown-image-id');
    }

    const refs = [
      ...claim.observationIds.map(id => ({ kind: 'observation' as const, id, text: observations.get(id)! })),
      ...claim.sourceIds.map(id => ({ kind: 'source' as const, id, text: sources.get(id)! })),
      ...(claim.calculationIds ?? []).map(id => ({ kind: 'calculation' as const, id, text: calculations.get(id)! })),
      ...(claim.interpretationRowIds??[]).map(id=>({kind:'interpretation' as const,id,text:interpretationRows.get(id)!})),
      ...(claim.packageFactIds??[]).map(id=>({kind:'package-fact' as const,id,text:packageFacts.get(id)!})),
      ...(claim.profileFieldIds ?? []).map(id => ({ kind: 'profile' as const, id, text: profileFields.get(id)! })),
    ];
    const spans = claim.supportingSpans??[];
    const validSpans=spans.filter(span=>refs.some(ref=>ref.kind===span.kind&&ref.id===span.id&&ref.text.includes(span.quote)));
    const mode = claim.mode;
    // Keep source/observation quotations scoped to the exact validated span.
    // Structured, evidence-linked package facts and reconstructed rows carry
    // their own stable references, so include their full normalized records
    // even when the model also supplied a shorter OCR quotation. This lets a
    // linked row supply its unit/basis without broadening an external source
    // citation beyond the span the model actually cited.
    const citedPackageFacts=[
      ...(claim.interpretationRowIds??[]).map(id=>interpretationRows.get(id)),
      ...(claim.packageFactIds??[]).map(id=>packageFacts.get(id)),
    ].filter((text):text is string=>typeof text==='string');
    const quantitySpans=validSpans.filter(span=>span.kind!=='source'||!webGroundingSourceIds.has(span.id));
    const quantityRefs=refs.filter(ref=>ref.kind!=='source'||!webGroundingSourceIds.has(ref.id));
    const evidenceTexts=validSpans.length
      ?[...quantitySpans.map(span=>span.quote),...citedPackageFacts]
      :quantityRefs.map(ref=>ref.text);
    // Structured label interpretations are usable, traceable candidates, not
    // independently verified package facts. Numeric wording must match the
    // exact interpreted row, including its printed unit and basis.
    const citedCalculationResults=(claim.calculationIds??[]).flatMap(id=>{
      const calculation=calculationsById.get(id);
      return calculation?[
        {value:calculation.result,unit:calculation.unit},
        {value:calculation.portion,unit:calculation.portionUnit},
      ]:[];
    });
    if (conflictsWithReconstructedNutrientAssociation(claim, reconstructionRows)) return reject('unsupported-nutrient-association');
    if (!numericMentionsAreSupported(claim.text, evidenceTexts,citedCalculationResults)) return reject('unsupported-numeric-value');
    if (!basisMentionsAreSupported(claim.text, evidenceTexts)) return reject('unsupported-basis');
    if(mode==='direct-quote'&&!validSpans.some(span=>span.quote===claim.text))return reject('direct-quote-needs-exact-evidence');
    const accepted = { ...claim, supportingSpans:validSpans, mode, text:claim.text };
    supportedByIndex.set(claimIndex, accepted);
    data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'accepted', ...(droppedUnavailablePackageFacts ? { reason: 'unavailable-package-fact-link-dropped' } : claim.interpretationRowIds?.length && !originalClaim.interpretationRowIds?.length ? { reason: 'linked-exact-provisional-reconstruction-row' } : {}) });
    return [accepted];
  });

  const seenUiTypes = new Set<string>();
  const uiComponents = (result.data.uiComponents ?? []).filter((component, componentIndex) => {
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'ui', index: componentIndex, decision: 'rejected', reason });
      return false;
    };
    if (component.observationIds.some(id => !observations.has(id))
      || component.sourceIds.some(id => !sources.has(id))
      || component.calculationIds.some(id => !calculations.has(id))) return reject('unknown-evidence-id');
    const hasObservations = component.observationIds.length > 0;
    const hasSources = component.sourceIds.length > 0;
    const hasCalculations = component.calculationIds.length > 0;
    const hasProductEvidence = component.sourceIds.some(id => data.evidence?.some(source => source.id === id && source.category === 'product'));
    const supportedByData = (() => { switch (component.type) {
      // A component may be backed by the saved multimodal reconstruction even
      // when the model's row/ingredient interpretation came from image regions
      // rather than OCR observation IDs.
      case 'nutrition-table': return (hasObservations && data.package.observations.length > 0) || traceableRows.length > 0;
      case 'portion-calculator': return hasCalculations;
      case 'ingredient-explorer':
        return hasObservations || hasReconstructedIngredients;
      case 'allergen-explanation': return hasObservations || hasReconstructedStatements;
      case 'package-evidence': return hasObservations || packageFacts.size > 0;
      case 'package-details': return hasObservations || packageFacts.size > 0;
      case 'source-reference-cards': return hasSources;
      case 'product-comparison': return hasObservations && hasProductEvidence;
      case 'personalized-finding': return supported.some(claim => (claim.profileFieldIds?.length ?? 0) > 0);
    } })();
    if (!supportedByData) return reject('component-not-supported-by-available-data');
    if (seenUiTypes.has(component.type)) return reject('duplicate-component-type');
    seenUiTypes.add(component.type);
    data.diagnostic?.({ stage: 'ui', index: componentIndex, decision: 'accepted' });
    return true;
  });

  if (result.data.inspectImage && !data.images?.some(image => image.handle === result.data.inspectImage!.handle)) {
    data.diagnostic?.({ stage: 'image-action', index: 0, decision: 'rejected', reason: 'unknown-image-id' });
  }
  const inspectImage = result.data.inspectImage && data.images?.some(image => image.handle === result.data.inspectImage!.handle)
    ? { ...result.data.inspectImage, reason: 'A specific package detail may need a closer look. Review the selected image before choosing to send it.' }
    : null;
  if (inspectImage) data.diagnostic?.({ stage: 'image-action', index: 0, decision: 'accepted' });

  const tentativeCandidates = (result.data.tentativeCandidates ?? []).flatMap((candidate, candidateIndex) => {
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'candidate', index: candidateIndex, decision: 'rejected', reason });
      return [];
    };
    if (candidate.observationIds.some(id => !observations.has(id)) || candidate.sourceIds.some(id => !sources.has(id))) {
      return reject('unknown-evidence-id');
    }
    const visualEvidence = candidate.visualEvidence ?? [];
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) return reject('unknown-image-id');

    const validSpans = candidate.supportingSpans.filter(span => {
      const evidence = span.kind === 'observation' ? observations.get(span.id) : sources.get(span.id);
      return !!evidence && evidence.includes(span.quote);
    });
    const linkedObservationIds = candidate.observationIds.filter(id => {
      const observation = data.package.observations.find(item => item.id === id);
      return observation?.origin === 'ocr' && observation.field === 'ocr-line'
        && validSpans.some(span => span.kind === 'observation' && span.id === id);
    });
    const linkedSourceIds = candidate.sourceIds.filter(id => validSpans.some(span => span.kind === 'source' && span.id === id));
    // Image-based readings are useful as traceable tentative candidates. A
    // region can support review, but exact OCR geometry remains mandatory for
    // downstream arithmetic and never promotes an image reading to package fact.
    const visualRegions = visualEvidence.filter(reference => !!reference.region);
    if (!validSpans.length && !visualRegions.length) return reject('no-traceable-package-evidence');
    if (!linkedObservationIds.length && !visualRegions.length) return reject('no-package-evidence');
    if (candidate.numericValue !== null) {
      const packageTextEvidence = [
        ...validSpans.filter(span => span.kind === 'observation').map(span => span.quote),
        ...visualRegions.map(reference => reference.visibleText),
      ];
      if (!packageTextEvidence.some(text => numericValueAppearsInEvidence(candidate.numericValue!, text))) {
        return reject('candidate-value-not-visible-in-package-evidence');
      }
    }

    const seenWordRoles = new Set<string>();
    const validWordEvidence = (candidate.ocrWordEvidence ?? []).filter(reference => {
      const observation = data.package.observations.find(item => item.id === reference.observationId);
      const roleKey = `${reference.observationId}:${reference.role}`;
      if (seenWordRoles.has(roleKey) || !linkedObservationIds.includes(reference.observationId) || !observation
        || observation.origin !== 'ocr' || observation.field !== 'ocr-line' || !observation.imageId
        || !observation.readingOrder || !observation.ocrWords) return false;
      const uniqueIndexes = new Set(reference.wordIndexes);
      const orderedIndexes = reference.wordIndexes.every((index, position) =>
        index < observation.ocrWords!.length && (position === 0 || index > reference.wordIndexes[position - 1]),
      );
      if (uniqueIndexes.size !== reference.wordIndexes.length || !orderedIndexes) return false;
      const selectedWords = reference.wordIndexes.map(index => normalizeEvidenceToken(observation.ocrWords![index].text));
      if (selectedWords.some(word => !word)) return false;
      const exactWordsLinked = validSpans.some(span => span.kind === 'observation' && span.id === observation.id && containsOrderedEvidenceTokens(span.quote, selectedWords));
      if (exactWordsLinked) seenWordRoles.add(roleKey);
      return exactWordsLinked;
    });

    const missingNumericWordRoles = candidate.kind === 'nutrient' && candidate.numericValue !== null
      && (['label', 'value', 'unit', 'basis'] as const).some(role => !validWordEvidence.some(reference => reference.role === role));
    const incompleteReferences = missingNumericWordRoles
      || linkedObservationIds.length !== candidate.observationIds.length
      || linkedSourceIds.length !== candidate.sourceIds.length
      || validSpans.length !== candidate.supportingSpans.length
      || validWordEvidence.length !== (candidate.ocrWordEvidence?.length ?? 0)
      || visualRegions.length !== visualEvidence.length;
    const linkNote = 'Some evidence links are incomplete; this remains unverified.';
    const uncertainty = incompleteReferences
      ? `${candidate.uncertainty.slice(0, Math.max(1, 500 - linkNote.length - 1))} ${linkNote}`
      : candidate.uncertainty;
    data.diagnostic?.({ stage: 'candidate', index: candidateIndex, decision: 'accepted', ...(incompleteReferences ? { reason: 'kept-tentative-with-only-exact-evidence-links' } : {}) });
    return [{
      ...candidate,
      observationIds: linkedObservationIds,
      sourceIds: linkedSourceIds,
      supportingSpans: validSpans,
      ...(candidate.visualEvidence ? { visualEvidence: visualRegions } : {}),
      ...(candidate.ocrWordEvidence ? { ocrWordEvidence: validWordEvidence } : {}),
      uncertainty,
    }];
  });

  const displayedClaimEntries = [...supportedByIndex.entries()].slice(0, 15);
  const displayedClaimsByIndex = new Map(displayedClaimEntries);
  const displayedClaims = displayedClaimEntries.map(([, claim]) => claim);
  const referencedEvidenceTexts = (claim: (typeof result.data.claims)[number]) => [
    ...claim.observationIds.map(id => observations.get(id)),
    ...claim.sourceIds.map(id => sources.get(id)),
    ...(claim.calculationIds ?? []).map(id => calculations.get(id)),
    ...(claim.interpretationRowIds ?? []).map(id => interpretationRows.get(id)),
    ...(claim.packageFactIds ?? []).map(id => packageFacts.get(id)),
    ...(claim.profileFieldIds ?? []).map(id => profileFields.get(id)),
  ].filter((text): text is string => typeof text === 'string');
  const answerEvidenceWithQuestion = (claims: readonly (typeof displayedClaims)[number][]) => [
    ...claims.flatMap(referencedEvidenceTexts),
    ...(data.question ? [data.question] : []),
  ];
  const answerCalculationResults = (claims: readonly (typeof displayedClaims)[number][]) =>
    [...new Set(claims.flatMap(claim => claim.calculationIds ?? []))].flatMap(id => {
      const calculation = calculationsById.get(id);
      return calculation ? [
        { value: calculation.result, unit: calculation.unit },
        { value: calculation.portion, unit: calculation.portionUnit },
      ] : [];
    });
  const validatedAnswerParts = (result.data.answerParts ?? []).flatMap((part, answerPartIndex) => {
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'answer-part', index: answerPartIndex, decision: 'rejected', reason });
      return [];
    };
    const linkedClaims = part.claimIndexes.map(index => displayedClaimsByIndex.get(index));
    if (!linkedClaims.length || linkedClaims.some(claim => !claim)) return reject('unsupported-claim-link');
    const claims = linkedClaims.filter((claim): claim is NonNullable<typeof claim> => !!claim);
    const evidence = answerEvidenceWithQuestion(claims);
    const text = part.text.replace(/\s+/g, ' ').trim();
    if (!text) return reject('empty-answer-part');
    if (!numericMentionsAreSupported(text, evidence, answerCalculationResults(claims))) return reject('unsupported-numeric-value');
    if (!basisMentionsAreSupported(text, evidence)) return reject('unsupported-basis');
    if (!namedSourceHasReference(text, [...new Set(claims.flatMap(claim => claim.sourceIds))], data.evidence ?? [])) return reject('named-source-needs-linked-source');
    data.diagnostic?.({ stage: 'answer-part', index: answerPartIndex, decision: 'accepted' });
    return [{ text, claimIndexes: part.claimIndexes, claims }];
  });

  // The answer is first-class model prose, but only explicitly mapped parts
  // can reach the user. A provider may add an unmapped sentence or format the
  // answerParts imperfectly; discard that remainder and retain independently
  // validated parts instead of throwing away the whole useful answer. Claims
  // are never manufactured from prose, and no unmapped text bypasses checks.
  const naturalAnswer = result.data.answer.replace(/\s+/g, ' ').trim();
  const normalizeAnswerText = (text: string) => text.replace(/\s+/g, ' ').trim();
  const rawAnswerParts = result.data.answerParts ?? [];
  const partsPartitionAnswer = !!naturalAnswer && rawAnswerParts.length > 0
    && normalizeAnswerText(rawAnswerParts.map(part => part.text).join(' ')) === normalizeAnswerText(naturalAnswer);
  let validatedNaturalAnswer: string | null = null;
  if (naturalAnswer && !rawAnswerParts.length) {
    data.diagnostic?.({ stage: 'natural-answer', index: 0, decision: 'rejected', reason: 'missing-answer-evidence-map' });
  } else if (validatedAnswerParts.length) {
    validatedNaturalAnswer = validatedAnswerParts.map(part => part.text).join(' ');
    const reason = !partsPartitionAnswer
      ? 'unmapped-answer-text-withheld'
      : validatedAnswerParts.length < rawAnswerParts.length
        ? 'unsupported-answer-parts-withheld'
        : 'model-answer-parts';
    data.diagnostic?.({ stage: 'natural-answer', index: 0, decision: 'accepted', reason });
  } else if (naturalAnswer) {
    data.diagnostic?.({ stage: 'natural-answer', index: 0, decision: 'rejected', reason: partsPartitionAnswer ? 'no-validated-answer-parts' : 'answer-evidence-map-does-not-partition-answer' });
  }

  const hasValidatedModelAnswer = !!validatedNaturalAnswer;
  const answerStatus = hasValidatedModelAnswer ? 'model-answer' as const
    : displayedClaims.length ? 'grounded-claims-answer-unavailable' as const
      : tentativeCandidates.length ? 'tentative-only' as const
        : 'insufficient-evidence' as const;
  const answer = validatedNaturalAnswer
    ?? (displayedClaims.length
      ? 'I found relevant package evidence, but could not safely assemble it into a clear answer. You can inspect the supporting details or ask a narrower follow-up.'
      : result.data.inspectImage
        ? 'I need a closer look at one part of the package before I can answer. Review the requested photo area and decide whether to send it.'
        : tentativeCandidates.length
          ? 'I found a few possible readings, but the current evidence does not establish enough to answer reliably. I can take a closer look at the relevant package area.'
          : 'I can’t establish a reliable answer from the package evidence available yet. The photos are still here, so you can try a closer view or ask about a detail that is legible.');
  data.diagnostic?.({
    stage: 'natural-answer', index: -1,
    decision: hasValidatedModelAnswer ? 'accepted' : 'rejected',
    reason: hasValidatedModelAnswer ? 'answer-ready' : answerStatus,
  });
  return {
    claims: displayedClaims,
    tentativeCandidates,
    uiComponents,
    limitations: result.data.limitations,
    inspectImage,
    answer,
  };
}
function normalizeEvidenceToken(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Word indexes must locate visible OCR text inside an exact quote for that same line. */
function containsOrderedEvidenceTokens(quote: string, words: string[]): boolean {
  const tokens = (quote.normalize('NFKC').match(/[\p{L}\p{N}]+(?:[.,/%'’-][\p{L}\p{N}]+)*/gu) ?? []).map(normalizeEvidenceToken);
  let cursor = 0;
  for (const word of words) {
    const index = tokens.indexOf(word, cursor);
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

type NumericDimension = 'mass' | 'energy' | 'volume' | 'length' | 'percent' | 'unitless' | 'age-year';
type NumericMention = { value: number; dimension: NumericDimension; rawValue: string; factor: number; decimalPlaces:number; localeAmbiguous: boolean; literalUnit?: string };
const numericMentionPattern = /(?<![\p{L}\p{N}_])(-?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?|\.\d+))(?!\d)\s*(?:-\s*(?=years?-old))?(years?-old|kcal|kilocalories?|kj|kilojoules?|mg|milligrams?|µg|μg|mcg|ug|micrograms?|kg|g|grams?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|mm|cm|metres?|meters?|m|%|percent)?(?![\p{L}\p{N}_])/giu;

/** Flatten presentation syntax only: never evaluate model-authored mathematics. */
function numericPresentationText(text: string): string {
  return text.replace(/\b(?:OBS|IMG|SRC|CALC|CAND|ROW)_[A-Z0-9]+\b/gi, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1')
    .replace(/\\(?:text|mathrm)\{([^{}\\\n]*)\}/g, '$1')
    .replace(/\\%/g, '%')
    .replace(/\\(?:leq|le)(?![a-z])/g, '≤')
    .replace(/\\(?:geq|ge)(?![a-z])/g, '≥');
}

function parseNumericLiteral(value: string): { value: number; localeAmbiguous: boolean } {
  if (value.includes(',') && value.includes('.')) {
    return {
      value: value.lastIndexOf(',') > value.lastIndexOf('.')
        ? Number(value.replaceAll('.', '').replace(',', '.'))
        : Number(value.replaceAll(',', '')),
      localeAmbiguous: false,
    };
  }
  if (value.includes(',')) {
    const [whole, fraction = ''] = value.split(',');
    return {
      value: fraction.length === 3 && whole.length > 0 ? Number(value.replaceAll(',', '')) : Number(value.replace(',', '.')),
      localeAmbiguous: /^-?\d+\,\d{3}$/.test(value),
    };
  }
  return { value: Number(value), localeAmbiguous: /^-?\d+\.\d{3}$/.test(value) };
}

function numericMentions(text: string): NumericMention[] {
  const result: NumericMention[] = [];
  for (const match of text.matchAll(numericMentionPattern)) {
    const parsed = parseNumericLiteral(match[1]);
    if (!Number.isFinite(parsed.value)) continue;
    const unit = (match[2] ?? '').toLocaleLowerCase().replace('μ', 'µ');
    let dimension: NumericDimension = 'unitless';
    let factor = 1;
    if (/^years?-old$/.test(unit)) dimension = 'age-year';
    else if (/^(?:mg|milligrams?)$/.test(unit)) { dimension = 'mass'; factor = 0.001; }
    else if (/^(?:µg|mcg|ug|micrograms?)$/.test(unit)) { dimension = 'mass'; factor = 0.000001; }
    else if (/^(?:kg)$/.test(unit)) { dimension = 'mass'; factor = 1000; }
    else if (/^(?:g|grams?)$/.test(unit)) dimension = 'mass';
    else if (/^(?:kj|kilojoules?)$/.test(unit)) { dimension = 'energy'; factor = 1 / 4.184; }
    else if (/^(?:kcal|kilocalories?)$/.test(unit)) dimension = 'energy';
    else if (/^(?:l|lit(?:er|re)s?)$/.test(unit)) { dimension = 'volume'; factor = 1000; }
    else if (/^(?:ml|millilit(?:er|re)s?)$/.test(unit)) dimension = 'volume';
    else if (unit === 'mm') { dimension = 'length'; factor = 0.001; }
    else if (unit === 'cm') { dimension = 'length'; factor = 0.01; }
    else if (/^(?:m|metres?|meters?)$/.test(unit)) dimension = 'length';
    else if (/^(?:%|percent)$/.test(unit)) dimension = 'percent';
    // SI symbols are case-sensitive: mM (a concentration) is not mm (length).
    // Preserve an unrecognized casing literally rather than lending it a
    // physical dimension or treating it as a unitless value.
    const literalUnit = /^(?:m|mm|cm)$/i.test(match[2] ?? '') && match[2] !== unit ? match[2] : undefined;
    if (literalUnit) { dimension = 'unitless'; factor = 1; }
    const separator=Math.max(match[1].lastIndexOf('.'),match[1].lastIndexOf(','));
    const decimalPlaces=separator<0?0:match[1].length-separator-1;
    result.push({ value: parsed.value * factor, dimension, rawValue: match[1], factor, decimalPlaces, localeAmbiguous: parsed.localeAmbiguous, literalUnit });
  }
  return result;
}

function numericComparisonOperator(text:string,index:number):'<='|'<'|'>='|'>'|null{
  const prefix=text.slice(Math.max(0,index-36),index);
  if(/(?:<=|≤|less than or equal to|at most|no more than|not greater than)\s*$/i.test(prefix))return'<=';
  if(/(?:>=|≥|greater than or equal to|at least|no less than|not less than)\s*$/i.test(prefix))return'>=';
  if(/(?:<|less than|below|under)\s*$/i.test(prefix))return'<';
  if(/(?:>|greater than|above|over)\s*$/i.test(prefix))return'>';
  return null;
}

function numericOccurrences(text:string){
  const matches=[...text.matchAll(numericMentionPattern)];
  return matches.flatMap((match,index)=>{
    const mention=numericMentions(match[0])[0];
    const end=(match.index??0)+match[0].length;
    // Keep the denominator of a dose/rate attached to its own amount. Stop at
    // the next number or sentence boundary so another quantity cannot lend its
    // time basis to this one. Substance wording between a unit and "per day"
    // is allowed; no ingredient, condition or endpoint keywords are involved.
    const suffix=text.slice(end,Math.min(matches[index+1]?.index??text.length,end+100)).split(/[.!?;,\n):\]}]/,1)[0];
    const previous=matches[index-1];
    const prefixStart=Math.max(0,previous?(previous.index??0)+previous[0].length:0,(match.index??0)-100);
    const prefix=text.slice(prefixStart,match.index??0).split(/[.!?;,\n:([{]/).at(-1)??'';
    // Frequency adverbs describe the same temporal unit even when the measured
    // item appears between the quantity and the rate ("25 g of fibre daily").
    // Scope remains bounded by the next number and sentence/clause boundary.
    const adverb=suffix.split(/[,:]/, 1)[0].match(/\b(hourly|daily|weekly|monthly|yearly|annually)\b/i)?.[1]
      ??prefix.match(/\b(hourly|daily|weekly|monthly|yearly|annually)\b[^.!?;\d]{0,60}$/i)?.[1];
    const adverbUnits: Record<string, string> = { hourly:'hour', daily:'day', weekly:'week', monthly:'month', yearly:'year', annually:'year' };
    const rate=suffix.match(/(?:\bper\s+|\/)\s*(?:a\s+|each\s+)?(hours?|days?|weeks?|months?|years?)\b/i)?.[1]
      ??(adverb?adverbUnits[adverb.toLowerCase()]:null);
    const timeBasis=rate?.toLowerCase().replace(/s$/,'')??null;
    const operator=numericComparisonOperator(text,match.index??0)
      ??(/^\s*(?:\*\*)?\s*or more\b/i.test(suffix)?'>=': /^\s*(?:\*\*)?\s*or less\b/i.test(suffix)?'<=':null);
    return mention?[{mention,operator,index:match.index??0,timeBasis}]:[];
  });
}

function isApproximateNumericClaim(text:string,index:number){
  return /(?:~|≈|\b(?:about|around|approximately|approx\.?|nearly|roughly))\s*$/i.test(text.slice(Math.max(0,index-24),index));
}

// Conventional denominator notation describes a measurement system, not a
// measured food amount. It cannot support another amount in the same sentence.
function referenceBasisRanges(text:string){
  return [...text.matchAll(/\bper\s*100\s*(?:g|grams?|ml|millilit(?:er|re)s?)\b(?:\s*(?:\/|\(\s*or)\s*100\s*(?:g|grams?|ml|millilit(?:er|re)s?)\b\s*\)?)?/gi)]
    .map(match=>({start:match.index!,end:match.index!+match[0].length}));
}

function hasMeasuredAmount(text:string,contextIdentifiers:ReadonlySet<string>=new Set()){
  const reference=referenceBasisRanges(text);
  return numericOccurrences(text).some(item=>{
    if(item.mention.dimension==='age-year'||reference.some(range=>item.index>=range.start&&item.index<range.end))return false;
    const identifier=item.mention.dimension==='unitless'&&!item.mention.literalUnit&&item.operator===null&&item.timeBasis===null?numericIdentifier(text,item.index,item.mention.rawValue):null;
    return !identifier||!contextIdentifiers.has(identifier);
  });
}

function basisMentionsAreSupported(text: string, evidenceTexts: string[],contextIdentifiers:ReadonlySet<string>=new Set(), calculations: readonly Pick<Calculation, 'result' | 'unit' | 'portion' | 'portionUnit'>[] = []): boolean {
  // Without a measured amount, allow discussion of standard denominators and
  // per-serving notation. Applying any actual amount still requires the
  // matching printed basis below and a separately supported quantity.
  if(!hasMeasuredAmount(text,contextIdentifiers))return true;
  const mentions = [
    ...text.matchAll(/\bper\s*\d+(?:[.,]\d+)?\s*(?:g|grams?|mg|milligrams?|kg|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/gi),
    ...text.matchAll(/\bper\s*(?:(?:each|a|one)\s+)?(?:servings?|portions?|packs?|packages?|biscuits?|pieces?)\b/gi),
  ];
  if (!mentions.length) return true;
  const evidence = evidenceTexts.map(normalizeLabelText);
  return mentions.every(mention => {
    const normalized = normalizeLabelText(mention[0]);
    if (evidence.some(text => text.includes(normalized))) return true;
    // A native result may be expressed per its requested portion, rather than
    // the label's printed denominator. Bind that basis to its adjacent result;
    // never add the calculated portion as a general-purpose evidence string.
    const denominator = numericMentions(mention[0].replace(/^per\s*/i, ''))[0];
    if (!denominator || denominator.localeAmbiguous) return false;
    const prefix = text.slice(0, mention.index);
    const numerator = numericOccurrences(prefix).at(-1);
    if (!numerator || numerator.operator !== null || numerator.timeBasis !== null) return false;
    const resultText = prefix.slice(numerator.index);
    if (/[;!?\n]|\.(?!\d)/.test(resultText)) return false;
    return calculations.some(calculation => {
      const portion = numericMentions(`${calculation.portion} ${calculation.portionUnit}`)[0];
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(portion.value), Math.abs(denominator.value)) * 8;
      return denominator.dimension === portion.dimension && !denominator.literalUnit
        && Math.abs(denominator.value - portion.value) <= tolerance
        && numericMentionsAreSupported(resultText, [], [{ value: calculation.result, unit: calculation.unit }]);
    });
  });
}

/** Arabic-numeric synthesis must match a quantity in its cited spans, allowing basic unit equivalence. */
function numericIdentifier(text:string,index:number,rawValue:string){
  if(!/^\d{1,4}$/.test(rawValue))return null;
  const word=/\b([\p{L}][\p{L}-]{0,39})\s+$/u.exec(text.slice(Math.max(0,index-45),index))?.[1];
  const following=/^\s+([\p{L}][\p{L}-]{0,39})\b/u.exec(text.slice(index+rawValue.length))?.[1]??'';
  // Counts follow their named subject ("13 trials", "927 participants").
  // Prefix conjunctions/articles vary between source and prose ("with" vs
  // "and"), so prefer the stable following noun; labels like "grade 3" and
  // "INS 955" retain their preceding identifier when no noun follows.
  return following?`${rawValue} ${following.toLocaleLowerCase('en')}`
    :word?`${word.toLocaleLowerCase('en')} ${rawValue}`:null;
}

function numericMentionsAreSupported(
  claim: string,
  citedSpans: string[],
  calculatedResults:{value:number;unit:string;id?:string}[]=[],
  contextIdentifiers:ReadonlySet<string>=new Set(),
  onCalculationMatch?:(id:string)=>void,
): boolean {
  claim = numericPresentationText(claim);
  const claimed = numericOccurrences(claim);
  if (!claimed.length) return true;
  const cited = citedSpans.flatMap(span => {
    const citationText=numericPresentationText(span);
    return numericOccurrences(citationText).map(item=>({...item,citationText,identifier:numericIdentifier(citationText,item.index,item.mention.rawValue)}));
  });
  // Calculations are typed application outputs, not locale-formatted strings.
  // A value such as 4.712 can look locale-ambiguous when parsed back from text,
  // which incorrectly rejects normal display rounding to 4.7. Keep the
  // unit-derived dimension and trust the structured numeric value.
  const calculated=calculatedResults.flatMap(item=>numericMentions(`${item.value} ${item.unit}`).map(mention=>({...mention,localeAmbiguous:false,id:item.id})));
  const references=hasMeasuredAmount(claim,contextIdentifiers)?[]:referenceBasisRanges(claim);
  return claimed.every(({mention:value,operator,index,timeBasis})=>{
    if(operator===null&&timeBasis===null&&references.some(range=>index>=range.start&&index<range.end))return true;
    // Preserve an exact user-supplied numeral identifier (e.g. a version or
    // classification). Adjacent words stay attached; the numeral alone
    // cannot corroborate a nutrient amount, participant total or other label.
    const identifier=value.dimension==='unitless'&&!value.literalUnit&&operator===null&&timeBasis===null?numericIdentifier(claim,index,value.rawValue):null;
    if(identifier&&contextIdentifiers.has(identifier))return true;
    const approximate=isApproximateNumericClaim(claim,index);
    const matchesEvidence=cited.some(candidate=>{
      const {mention:evidence,operator:evidenceOperator,timeBasis:evidenceTimeBasis}=candidate;
      if(value.dimension!==evidence.dimension||value.literalUnit!==evidence.literalUnit||operator!==evidenceOperator||timeBasis!==evidenceTimeBasis)return false;
      const unitlessIdentifier=value.dimension==='unitless'&&!value.literalUnit&&operator===null&&timeBasis===null
        ?numericIdentifier(claim,index,value.rawValue):null;
      if(unitlessIdentifier&&candidate.identifier&&unitlessIdentifier!==candidate.identifier)return false;
      if(value.localeAmbiguous||evidence.localeAmbiguous){
        if(value.localeAmbiguous&&evidence.localeAmbiguous)return value.rawValue===evidence.rawValue&&value.factor===evidence.factor;
        // In English output, comma-grouped thousands can be parsed as a
        // locale-ambiguous decimal. Accept that presentation only when the
        // exact grouped integer matches an independently stored numeric fact
        // with the same unit dimension; e.g. 2,283 mg against 2283 mg.
        const grouped=value.localeAmbiguous?value:evidence;
        const unambiguous=value.localeAmbiguous?evidence:value;
        if(!/^\d{1,3}(?:,\d{3})+$/.test(grouped.rawValue))return false;
        const groupedValue=Number(grouped.rawValue.replaceAll(',',''))*grouped.factor;
        const tolerance=Number.EPSILON*Math.max(1,Math.abs(groupedValue),Math.abs(unambiguous.value))*8;
        return Math.abs(groupedValue-unambiguous.value)<=tolerance;
      }
      const tolerance=Number.EPSILON*Math.max(1,Math.abs(value.value),Math.abs(evidence.value))*8;
      if(Math.abs(value.value-evidence.value)<=tolerance)return true;
      if(!approximate||value.value===0||evidence.value===0)return false;
      // Explicit approximation may use conventional rounding at the displayed
      // precision. Exact-looking numbers still require an exact evidence match.
      const roundingTolerance=0.5*10**(-value.decimalPlaces)*value.factor;
      return Math.abs(value.value-evidence.value)<=roundingTolerance+tolerance;
    });
    const matchingCalculations=calculated.filter(result=>{
      if(timeBasis!==null||operator!==null||value.dimension!==result.dimension||value.literalUnit!==result.literalUnit||value.localeAmbiguous||result.localeAmbiguous)return false;
      // Do not let rounding turn a small non-zero amount into an asserted zero.
      if(value.value===0||result.value===0)return value.value===result.value;
      const roundingTolerance=0.5*10**(-value.decimalPlaces)*value.factor;
      const floatingTolerance=Number.EPSILON*Math.max(1,Math.abs(value.value),Math.abs(result.value))*8;
      return Math.abs(value.value-result.value)<=roundingTolerance+floatingTolerance;
    });
    for(const result of matchingCalculations)if(result.id)onCalculationMatch?.(result.id);
    return matchesEvidence||matchingCalculations.length>0;
  });
}

/**
 * Keep natural Gemini prose as the conversation contract. This guard checks
 * only precise quantities and printed bases; it does not classify topics,
 * require claim arrays, align prose to model-authored evidence IDs, or infer
 * source relevance from lexical overlap.
 * Raw OCR lines are deliberately excluded as numeric authority.
 */
export function validateNaturalAnswerText(
  answer: string,
  context: Pick<AssistValidationContext, 'package' | 'question' | 'evidence' | 'calculations'> & {
    /** Source-derived numbers may support only sentences that cite that source. */
    sourceIdsForSentence?: (sentence: string) => readonly string[];
    onWithheldSentence?: (decision: { text: string; reason: 'unsupported-quantity' | 'unsupported-basis' }) => void;
  },
): { answer: string; acceptedSentenceCount: number; withheldUnsupportedQuantitySentenceCount: number; provisionalReconstructionQuantitySentenceCount:number; calculationIds:string[] } {
  const normalized = answer.replace(/\r\n?/g, '\n').trim().slice(0, 7000);
  const pkg = context.package;
  const supersededObservationIds=new Set(pkg.observations.flatMap(observation=>observation.supersedesObservationIds??[]));
  const currentCalculations=(context.calculations??[]).filter(calculation=>calculationRespectsCorrections(pkg,calculation));
  const provisionalReconstructionEvidenceTexts = pkg.reconstruction?.current ? [
    ...pkg.reconstruction.nutritionRows.filter(row =>
      !reconstructionRowIsSuperseded(pkg,row) && row.value !== null && row.unit
      && ['clear','provisional'].includes(row.status)
      && (row.evidence.observationIds.length > 0 || row.evidence.imageRegions.length > 0)
      && !row.evidence.observationIds.some(id => pkg.observations.some(observation => observation.id === id && observation.origin === 'user')),
    ).map(row => `${row.nutrient} ${row.printedValue ?? ''} ${row.value} ${row.unit} ${row.basisAmount ?? ''} ${row.basisUnit ?? ''}`),
    ...pkg.reconstruction.ingredients.filter(item => ['clear','provisional'].includes(item.status)
      && (item.evidence.observationIds.length > 0 || item.evidence.imageRegions.length > 0)
      && item.printedPercentage !== null).map(item => `${item.name} ${item.printedPercentage}%`),
    ...pkg.reconstruction.statements.filter(item => ['clear','provisional'].includes(item.status)
      && (item.evidence.observationIds.length > 0 || item.evidence.imageRegions.length > 0)).map(item => item.text),
    ...(pkg.reconstruction.quantityDeclarations ?? []).filter(item => ['clear','provisional'].includes(item.status)
      && (item.evidence.observationIds.length > 0 || item.evidence.imageRegions.length > 0))
      .map(item => `${item.printedText ?? ''} ${item.quantity ?? ''} ${item.unit ?? ''}`),
    ...(pkg.reconstruction.serving && ['clear','provisional'].includes(pkg.reconstruction.serving.status)
      && pkg.reconstruction.serving.quantity !== null
      && (pkg.reconstruction.serving.evidence.observationIds.length > 0 || pkg.reconstruction.serving.evidence.imageRegions.length > 0)
      && !pkg.reconstruction.serving.evidence.observationIds.some(id => pkg.observations.some(observation => observation.id === id && observation.origin === 'user'))
      ? [`${pkg.reconstruction.serving.printedText ?? ''} ${pkg.reconstruction.serving.quantity} ${pkg.reconstruction.serving.unit ?? ''} ${pkg.reconstruction.serving.pieceCount ?? ''} ${pkg.reconstruction.serving.pieceDescription ?? ''}`]
      : []),
  ] : [];
  const reconstructedBasisEvidence = pkg.reconstruction?.current
    ? pkg.reconstruction.nutritionRows.flatMap(row => {
      if (reconstructionRowIsSuperseded(pkg,row) || row.value === null || !row.unit || !row.basisAmount || !row.basisUnit
        || !['clear', 'provisional'].includes(row.status)
        || (!row.evidence.observationIds.length && !row.evidence.imageRegions.length)) return [];
      const basis = `per ${row.basisAmount} ${row.basisUnit}`;
      const serving = pkg.reconstruction?.serving;
      const servingMatches = serving && ['clear', 'provisional'].includes(serving.status)
        && serving.quantity !== null && serving.unit === row.basisUnit
        && Math.abs(serving.quantity - row.basisAmount) <= Number.EPSILON * Math.max(1, serving.quantity, row.basisAmount) * 8;
      return [basis, ...(servingMatches ? [`${basis} serving`] : [])];
    })
    : [];
  const evidenceTexts = [
    ...pkg.observations.filter(item => item.origin !== 'ocr' && !supersededObservationIds.has(item.id)).map(item => item.text),
    ...pkg.nutrients.filter(item => item.status !== 'conflict' && item.basis && (!pkg.reconstruction?.current || item.status === 'corrected')).map(item =>
      `${item.key} ${item.value} ${item.unit} per ${item.basis!.amount} ${item.basis!.unit}`),
    ...(pkg.reconstruction?.current&&pkg.reconstruction.serving
      &&['clear','provisional'].includes(pkg.reconstruction.serving.status)
      &&pkg.reconstruction.serving.quantity!==null&&pkg.reconstruction.serving.unit
      &&(pkg.reconstruction.serving.evidence.observationIds.length>0||pkg.reconstruction.serving.evidence.imageRegions.length>0)
      ?[`per serving ${pkg.reconstruction.serving.printedText??''} ${pkg.reconstruction.serving.quantity} ${pkg.reconstruction.serving.unit}`]
      :[]),
    ...(pkg.reconstruction?.current ? [
      ...(pkg.reconstruction.serving && ['clear', 'provisional'].includes(pkg.reconstruction.serving.status)
        ? [`${pkg.reconstruction.serving.printedText ?? ''} ${pkg.reconstruction.serving.quantity ?? ''} ${pkg.reconstruction.serving.unit ?? ''} ${pkg.reconstruction.serving.pieceCount ?? ''} ${pkg.reconstruction.serving.pieceDescription ?? ''}`]
        : []),
      ...pkg.reconstruction.nutritionRows.filter(row =>
        !reconstructionRowIsSuperseded(pkg,row) && row.value !== null && row.unit && ['clear', 'provisional'].includes(row.status)
        && (row.evidence.observationIds.length > 0 || row.evidence.imageRegions.length > 0),
      ).map(row => `${row.nutrient} ${row.printedLabel} ${row.printedValue ?? ''} ${row.value} ${row.unit} ${row.columnLabel ?? ''} ${row.basisText ?? ''} ${row.basisAmount ?? ''} ${row.basisUnit ?? ''}`),
      ...pkg.reconstruction.ingredients.filter(item => ['clear', 'provisional'].includes(item.status)
        && (item.evidence.observationIds.length > 0 || item.evidence.imageRegions.length > 0))
        .map(item => `${item.name} ${item.printedText} ${item.printedPercentage ?? ''}%`),
      ...pkg.reconstruction.statements.filter(item => ['clear', 'provisional'].includes(item.status)
        && (item.evidence.observationIds.length > 0 || item.evidence.imageRegions.length > 0))
        .map(item => `${item.label ?? ''} ${item.text}`),
      ...(pkg.reconstruction.quantityDeclarations??[]).filter(item=>['clear','provisional'].includes(item.status)
        &&(item.evidence.observationIds.length>0||item.evidence.imageRegions.length>0))
        .map(item=>`${item.printedText??''} ${item.quantity??''} ${item.unit??''} ${item.kind}`),
    ] : []),
    ...reconstructedBasisEvidence,
    // Explicit age is user context, not package composition. Only this typed
    // representation is admitted; question numbers never corroborate nutrients.
    ...numericOccurrences(context.question??'').filter(item=>item.mention.dimension==='age-year'&&item.operator===null)
      .map(item=>`${item.mention.rawValue} year-old`),
    ...currentCalculations.map(calculation => calculationEvidenceText(calculation)),
  ].filter(Boolean);
  const userConfirmedQuantityTexts=[
    ...pkg.nutrients.filter(item => item.status === 'corrected' && item.basis)
      .map(item => `${item.key} ${item.value} ${item.unit} per ${item.basis!.amount} ${item.basis!.unit}`),
    ...pkg.observations.filter(item => item.origin === 'user' && !supersededObservationIds.has(item.id)).map(item => item.text),
  ];
  const mentionMatchesEvidence=(mention:NumericMention,evidence:readonly string[])=>evidence.some(candidate=>numericMentions(candidate).some(supported=>
    !mention.localeAmbiguous && !supported.localeAmbiguous && mention.dimension === supported.dimension
    && mention.literalUnit === supported.literalUnit
    && Math.abs(mention.value-supported.value) <= Number.EPSILON*Math.max(1,Math.abs(mention.value),Math.abs(supported.value))*8,
  ));
  const hasUnconfirmedReconstructionQuantity=(text:string)=>numericMentions(text).some(mention=>
    mentionMatchesEvidence(mention,provisionalReconstructionEvidenceTexts) && !mentionMatchesEvidence(mention,userConfirmedQuantityTexts));
  // Google grounding summaries are generated response segments linked to a
  // page, not text fetched from that page. Keep the citation visible, but do
  // not let a generated number corroborate itself at the quantity boundary.
  const sourceEvidenceById=new Map((context.evidence??[]).filter(source=>source.category!=='web-search').map(source=>[source.id,[
    source.title,source.publisher,source.url,source.summary,source.limitations,
    ...(source.publishedAt?.match(/^\d{4}(?:-|$)/)?[source.publishedAt.slice(0,4)]:[]),
  ].filter(Boolean).join(' ')]));
  const calculatedResults = currentCalculations.map(item => ({ id:item.id,value: item.result, unit: item.unit }));
  const contextText=numericPresentationText(context.question??'');
  const contextIdentifiers=new Set(numericOccurrences(contextText).flatMap(item=>{
    if(item.mention.dimension!=='unitless'||item.mention.literalUnit||item.operator!==null||item.timeBasis!==null)return[];
    const identifier=numericIdentifier(contextText,item.index,item.mention.rawValue);return identifier?[identifier]:[];
  }));
  const acceptedLines: string[] = [];
  const acceptedCalculationIds=new Set<string>();
  let acceptedSentenceCount = 0;
  let withheldUnsupportedQuantitySentenceCount = 0;
  let provisionalReconstructionQuantitySentenceCount = 0;
  for (const line of normalized.split('\n')) {
    const acceptedSentences: string[] = [];
    const trimmed=line.trim();
    const headingPrefix=trimmed.match(/^#{1,6}\s+/)?.[0]??'';
    const content=trimmed.slice(headingPrefix.length);
    const listPrefix=content.match(/^(?:\d+[.)]|[-*+])\s+/)?.[0]??'';
    const sentences = content.slice(listPrefix.length).split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u).filter(Boolean);
    for (const sentence of sentences) {
      // Markdown list numbering is presentation syntax, not a factual amount.
      // Strong-emphasis delimiters are presentation, not part of an amount,
      // comparator or basis. Keep the original prose for rendering.
      const checkingText=numericPresentationText(sentence);
      const sentenceCalculationIds=new Set<string>();
      const citedSourceTexts=(context.sourceIdsForSentence?.(sentence)??[]).flatMap(id=>sourceEvidenceById.has(id)?[sourceEvidenceById.get(id)!]:[]);
      const sentenceEvidenceTexts=[...evidenceTexts,...citedSourceTexts];
      const quantitySupported = numericMentionsAreSupported(checkingText, sentenceEvidenceTexts, calculatedResults,contextIdentifiers,id=>sentenceCalculationIds.add(id));
      const basisSupported = quantitySupported && basisMentionsAreSupported(checkingText, sentenceEvidenceTexts,contextIdentifiers,currentCalculations);
      if (!quantitySupported || !basisSupported) {
        withheldUnsupportedQuantitySentenceCount += 1;
        context.onWithheldSentence?.({ text: sentence, reason: quantitySupported ? 'unsupported-basis' : 'unsupported-quantity' });
        continue;
      }
      const usesProvisionalCalculation=[...sentenceCalculationIds].some(id=>currentCalculations.some(calculation=>calculation.id===id&&calculation.inputOrigin==='model-interpretation'));
      if (usesProvisionalCalculation || (hasMeasuredAmount(checkingText,contextIdentifiers) && hasUnconfirmedReconstructionQuantity(checkingText))) provisionalReconstructionQuantitySentenceCount += 1;
      for(const id of sentenceCalculationIds)acceptedCalculationIds.add(id);
      acceptedSentences.push(sentence);
      acceptedSentenceCount += 1;
    }
    if (acceptedSentences.length) acceptedLines.push(headingPrefix+listPrefix+acceptedSentences.join(' '));
  }
  const acceptedAnswer = acceptedLines.join('\n').trim();
  if (acceptedAnswer && (withheldUnsupportedQuantitySentenceCount || provisionalReconstructionQuantitySentenceCount)) {
    const notices:string[]=[];
    if (withheldUnsupportedQuantitySentenceCount) notices.push('I omitted one or more numerical statements that the available evidence could not verify.');
    if (provisionalReconstructionQuantitySentenceCount) notices.push('Some numbers are provisional package readings; confirm them in Package details.');
    acceptedLines.push('', notices.join(' '));
  }
  return {
    answer: acceptedLines.join('\n').trim(),
    acceptedSentenceCount,
    withheldUnsupportedQuantitySentenceCount,
    provisionalReconstructionQuantitySentenceCount,
    calculationIds:[...acceptedCalculationIds],
  };
}

function numericValueAppearsInEvidence(value: number, text: string): boolean {
  return numericMentions(text).some(evidence => {
    if (evidence.localeAmbiguous) {
      return evidence.rawValue.replace(/[.,]/g, '') === value.toString().replace(/[.,]/g, '');
    }
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(evidence.value)) * 8;
    return Math.abs(value - evidence.value) <= tolerance;
  });
}
