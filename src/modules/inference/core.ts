import {
  calculationEvidenceText,
  type Calculation,
  type EvidenceSource,
  type PackageData,
  type Profile,
} from '../../lib/contracts';
import { InferenceModuleError } from './errors';
import { assistOutput } from './schema';

export type AssistValidationContext = {
  package: PackageData;
  evidence?: EvidenceSource[];
  calculations?: Calculation[];
  profile?: Profile;
  images?: { handle: string }[];
  diagnostic?: (event: { stage: 'claim' | 'answer-part' | 'candidate' | 'ui' | 'image-action'; index: number; decision: 'accepted' | 'rejected'; reason?: string }) => void;
};

function fail(code: ConstructorParameters<typeof InferenceModuleError>[0], message: string): never {
  throw new InferenceModuleError(code, message);
}

function isUnsafeMedicalConclusion(text: string) {
  const safetyVerdict = /\b(?:is|are|may be|might be|seems? to be|considered)\s+(?:safe|unsafe|suitable|unsuitable)\b|\b(?:is|are)\s+not\s+(?:safe|suitable)\b/i.test(text);
  const explicitSafetyCaveat = /\b(?:does not|doesn't|cannot|can't|unable to|insufficient evidence|insufficient information|no evidence (?:that|to conclude)|not enough (?:evidence|information)|not established|unclear whether)\b.{0,120}\b(?:safe|unsafe|suitable|unsuitable)\b/i.test(text);
  return (safetyVerdict && !explicitSafetyCaveat)
    || /\b(?:you should|you must|you need to)\b.{0,80}\b(?:eat|consume|avoid|limit|take|stop|start|adjust|increase|decrease|treat|dose|medication|insulin)\b/i.test(text)
    || /\b(?:diagnose|treat|cure)\s+(?:you|your|diabetes|hypertension|kidney disease|an allergy)\b/i.test(text);
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
  // Source limitations are attributable evidence too. A model must be able to
  // cite the record's own scope caveat rather than making it an unsupported
  // disclaimer that the exact-span validator silently drops.
  const sources = new Map((data.evidence ?? []).map(source => [source.id, `${source.summary}\n${source.limitations}`]));
  const calculations = new Map((data.calculations ?? []).map(calculation => [
    calculation.id,
    calculation.evidenceText ?? calculationEvidenceText(calculation),
  ]));
  const profileFields = new Map(Object.entries(data.profile ?? {}).filter(([, value]) => value.trim().length > 0));
  const imageIds = new Set((data.images ?? []).map(image => image.handle));

  const supportedByIndex = new Map<number, (typeof result.data.claims)[number]>();
  const supported = result.data.claims.flatMap((claim, claimIndex) => {
    const reject = (reason: string) => {
      data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'rejected', reason });
      return [];
    };
    const visualEvidence = claim.visualEvidence ?? [];
    if (!claim.observationIds.length && !claim.sourceIds.length && !(claim.calculationIds?.length) && !(claim.profileFieldIds?.length) && !visualEvidence.length) return reject('no-evidence-reference');
    if (claim.observationIds.some(id => !observations.has(id))
      || claim.sourceIds.some(id => !sources.has(id))
      || (claim.calculationIds ?? []).some(id => !calculations.has(id))
      || (claim.profileFieldIds ?? []).some(id => !profileFields.has(id))) return reject('unknown-evidence-id');
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) {
      return reject('unknown-image-id');
    }

    const refs = [
      ...claim.observationIds.map(id => ({ kind: 'observation' as const, id, text: observations.get(id)! })),
      ...claim.sourceIds.map(id => ({ kind: 'source' as const, id, text: sources.get(id)! })),
      ...(claim.calculationIds ?? []).map(id => ({ kind: 'calculation' as const, id, text: calculations.get(id)! })),
      ...(claim.profileFieldIds ?? []).map(id => ({ kind: 'profile' as const, id, text: profileFields.get(id)! })),
    ];
    const spans = claim.supportingSpans;
    const allRefsHaveExactQuotes = refs.every(ref => spans.some(span => span.kind === ref.kind && span.id === ref.id && ref.text.includes(span.quote)));
    const noUncitedSpan = spans.every(span => refs.some(ref => ref.kind === span.kind && ref.id === span.id));
    // Exact spans establish traceability, not entailment; synthesis remains labeled.
    const mode = claim.mode;
    const literalClaim = spans.find(span => span.quote === claim.text);
    // A model-generated visualEvidence.visibleText is an interpretation, not an
    // independent witness. Allowing it to corroborate the same model's numeric
    // claim made wrong visual readings self-validating (for example, 69.98% vs
    // the OCR line's 89.98%). Image-only numeric readings remain candidates in
    // the inspector until OCR or another independent source supports them.
    if (mode === 'synthesis' && !numericMentionsAreSupported(claim.text, spans.map(span => span.quote))) return reject('unsupported-numeric-value');
    // Keep evidence-linked limitations, while withholding individual safety
    // verdicts and treatment directives.
    if (!allRefsHaveExactQuotes) return reject('supporting-span-not-found');
    if (!noUncitedSpan) return reject('uncited-supporting-span');
    if (mode === 'direct-quote' && !literalClaim) return reject('direct-quote-mismatch');
    if (mode === 'synthesis' && isUnsafeMedicalConclusion(claim.text)) return reject('unsafe-medical-conclusion');
    const accepted = { ...claim, mode, text: mode === 'direct-quote' ? literalClaim!.quote : claim.text };
    supportedByIndex.set(claimIndex, accepted);
    data.diagnostic?.({ stage: 'claim', index: claimIndex, decision: 'accepted' });
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
      case 'nutrition-table': return hasObservations && data.package.observations.length > 0;
      case 'portion-calculator': return hasCalculations;
      case 'ingredient-explorer':
      case 'allergen-explanation':
      case 'package-evidence':
      case 'package-details': return hasObservations;
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

  const displayedClaimsByIndex = new Map<number, (typeof supported)[number]>();
  let displayedClaimLength = 0;
  for (let claimIndex = 0; claimIndex < result.data.claims.length; claimIndex += 1) {
    const claim = supportedByIndex.get(claimIndex);
    if (!claim || displayedClaimLength + claim.text.length > 6800) continue;
    displayedClaimsByIndex.set(claimIndex, claim);
    displayedClaimLength += claim.text.length;
  }
  const displayedClaims = [...displayedClaimsByIndex.values()];

  const answerPartRejections: string[] = [];
  const validatedAnswerParts = (result.data.answerParts ?? []).flatMap((part, answerPartIndex) => {
    const reject = (reason: string) => {
      answerPartRejections.push(reason);
      data.diagnostic?.({ stage: 'answer-part', index: answerPartIndex, decision: 'rejected', reason });
      return [];
    };
    const linkedClaims = part.claimIndexes.map(index => displayedClaimsByIndex.get(index));
    if (!linkedClaims.length || linkedClaims.some(claim => !claim)) return reject('unsupported-claim-link');
    const answerText = part.text.replace(/\s+/g, ' ').trim();
    if (!answerText) return reject('empty-answer-part');
    const linkedEvidence = linkedClaims.flatMap(claim => claim!.supportingSpans.map(span => span.quote));
    // A conversational synthesis may paraphrase its linked, accepted claims.
    // Keep numeric and absolute medical-safety checks strict; claimIndexes keep
    // the prose attached to the evidence that the UI can disclose on demand.
    if (!numericMentionsAreSupported(answerText, linkedEvidence)) return reject('unsupported-numeric-value');
    if (isUnsafeMedicalConclusion(answerText)) return reject('unsafe-medical-conclusion');
    data.diagnostic?.({ stage: 'answer-part', index: answerPartIndex, decision: 'accepted' });
    return [answerText];
  });
  // Keep every independently grounded part. One malformed claim reference in
  // a supplemental sentence must not erase the answer that passed validation.
  const hasValidatedModelAnswer = validatedAnswerParts.length > 0;
  const answer = hasValidatedModelAnswer
    ? validatedAnswerParts.join('\n\n')
    : displayedClaims.length
      ? 'I found relevant package evidence, but could not safely assemble it into a clear answer. You can inspect the supporting details or ask a narrower follow-up.'
    : result.data.inspectImage
      ? 'I need a closer look at one part of the package before I can answer. Review the requested photo area and decide whether to send it.'
      : tentativeCandidates.length
        ? 'I found a few possible readings, but the current evidence does not establish enough to answer reliably. I can take a closer look at the relevant package area.'
        : 'I can’t establish a reliable answer from the package evidence available yet. The photos are still here, so you can try a closer view or ask about a detail that is legible.';

  const answerStatus = hasValidatedModelAnswer ? 'model-answer' as const
    : displayedClaims.length ? 'grounded-claims-answer-unavailable' as const
      : tentativeCandidates.length ? 'tentative-only' as const
        : 'insufficient-evidence' as const;
  data.diagnostic?.({ stage: 'answer-part', index: -1, decision: hasValidatedModelAnswer ? 'accepted' : 'rejected', reason: hasValidatedModelAnswer ? 'answer-ready' : answerStatus });
  return {
    claims: displayedClaims,
    tentativeCandidates,
    uiComponents,
    limitations: ['Generated explanations are not independently verified. Tentative candidates never alter original package observations. The application may use a complete OCR-linked candidate only for explicitly labeled arithmetic after checking its evidence and layout; that reading remains unverified. Image-only text and region references stay outside calculations. No diagnosis, medication advice, or safety assessment is provided.'],
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

type NumericDimension = 'mass' | 'energy' | 'volume' | 'percent' | 'unitless';
type NumericMention = { value: number; dimension: NumericDimension; rawValue: string; factor: number; localeAmbiguous: boolean };
const numericMentionPattern = /(?<![\p{L}\p{N}])(-?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?|\.\d+))(?!\d)\s*(kcal|kilocalories?|kj|kilojoules?|mg|milligrams?|µg|μg|mcg|ug|micrograms?|kg|g|grams?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|%|percent)?(?![\p{L}])/giu;

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
    if (/^(?:mg|milligrams?)$/.test(unit)) { dimension = 'mass'; factor = 0.001; }
    else if (/^(?:µg|mcg|ug|micrograms?)$/.test(unit)) { dimension = 'mass'; factor = 0.000001; }
    else if (/^(?:kg)$/.test(unit)) { dimension = 'mass'; factor = 1000; }
    else if (/^(?:g|grams?)$/.test(unit)) dimension = 'mass';
    else if (/^(?:kj|kilojoules?)$/.test(unit)) { dimension = 'energy'; factor = 1 / 4.184; }
    else if (/^(?:kcal|kilocalories?)$/.test(unit)) dimension = 'energy';
    else if (/^(?:l|lit(?:er|re)s?)$/.test(unit)) { dimension = 'volume'; factor = 1000; }
    else if (/^(?:ml|millilit(?:er|re)s?)$/.test(unit)) dimension = 'volume';
    else if (/^(?:%|percent)$/.test(unit)) dimension = 'percent';
    result.push({ value: parsed.value * factor, dimension, rawValue: match[1], factor, localeAmbiguous: parsed.localeAmbiguous });
  }
  return result;
}

/** Arabic-numeric synthesis must match a quantity in its cited spans, allowing basic unit equivalence. */
function numericMentionsAreSupported(claim: string, citedSpans: string[]): boolean {
  const claimed = numericMentions(claim);
  if (!claimed.length) return true;
  const cited = citedSpans.flatMap(numericMentions);
  return claimed.every(value => cited.some(evidence => {
    if (value.dimension !== evidence.dimension) return false;
    if (value.localeAmbiguous || evidence.localeAmbiguous) {
      return value.localeAmbiguous && evidence.localeAmbiguous && value.rawValue === evidence.rawValue && value.factor === evidence.factor;
    }
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value.value), Math.abs(evidence.value)) * 8;
    return Math.abs(value.value - evidence.value) <= tolerance;
  }));
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
