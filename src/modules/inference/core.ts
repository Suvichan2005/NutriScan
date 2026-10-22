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
};

function fail(code: ConstructorParameters<typeof InferenceModuleError>[0], message: string): never {
  throw new InferenceModuleError(code, message);
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

  const supported = result.data.claims.flatMap(claim => {
    const visualEvidence = claim.visualEvidence ?? [];
    if (
      (!claim.observationIds.length && !claim.sourceIds.length && !(claim.calculationIds?.length) && !(claim.profileFieldIds?.length) && !visualEvidence.length)
      || claim.observationIds.some(id => !observations.has(id))
      || claim.sourceIds.some(id => !sources.has(id))
      || (claim.calculationIds ?? []).some(id => !calculations.has(id))
      || (claim.profileFieldIds ?? []).some(id => !profileFields.has(id))
    ) fail('unknown_citation', 'The model used missing or unknown evidence identifiers. No result was accepted.');
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) {
      fail('unknown_image', 'The model used an image that was not attached to this request. No result was accepted.');
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
    if (mode === 'synthesis' && !numericMentionsAreSupported(claim.text, [...spans.map(span => span.quote), ...visualEvidence.map(reference => reference.visibleText)])) return [];
    // Mentioning a dose or clinical reference in a limitation is useful and
    // should not be mistaken for dosing advice. Block actual individualized
    // safety verdicts and treatment directives instead.
    const safetyVerdict = /\b(?:is|are|may be|might be|seems? to be|considered)\s+(?:safe|unsafe|suitable|unsuitable)\b|\b(?:is|are)\s+not\s+(?:safe|suitable)\b/i.test(claim.text);
    const explicitSafetyCaveat = /\b(?:does not|doesn't|cannot|can't|unable to|insufficient evidence|insufficient information|no evidence (?:that|to conclude)|not enough evidence)\b.{0,80}\b(?:safe|unsafe|suitable|unsuitable)\b/i.test(claim.text);
    const unsafeMedicalConclusion =
      safetyVerdict && !explicitSafetyCaveat
      || /\b(?:you should|you must|you need to)\b.{0,80}\b(?:eat|consume|avoid|limit|take|stop|start|adjust|increase|decrease|treat|dose|medication|insulin)\b/i.test(claim.text)
      || /\b(?:diagnose|treat|cure)\s+(?:you|your|diabetes|hypertension|kidney disease|an allergy)\b/i.test(claim.text);
    if (!allRefsHaveExactQuotes || !noUncitedSpan || mode === 'direct-quote' && !literalClaim || mode === 'synthesis' && unsafeMedicalConclusion) return [];
    return [{ ...claim, mode, text: mode === 'direct-quote' ? literalClaim!.quote : claim.text }];
  });

  const seenUiTypes = new Set<string>();
  const uiComponents = (result.data.uiComponents ?? []).filter(component => {
    if (seenUiTypes.has(component.type)) return false;
    seenUiTypes.add(component.type);
    if (component.observationIds.some(id => !observations.has(id))
      || component.sourceIds.some(id => !sources.has(id))
      || component.calculationIds.some(id => !calculations.has(id))) return false;

    const hasObservations = component.observationIds.length > 0;
    const hasSources = component.sourceIds.length > 0;
    const hasCalculations = component.calculationIds.length > 0;
    const hasProductEvidence = component.sourceIds.some(id => data.evidence?.some(source => source.id === id && source.category === 'product'));
    switch (component.type) {
      case 'nutrition-table':
        return hasObservations && data.package.observations.length > 0;
      case 'portion-calculator':
        return hasCalculations;
      case 'ingredient-explorer':
      case 'allergen-explanation':
      case 'package-evidence':
      case 'package-details':
        return hasObservations;
      case 'source-reference-cards':
        return hasSources;
      case 'product-comparison':
        return hasObservations && hasProductEvidence;
      case 'personalized-finding':
        return supported.some(claim => (claim.profileFieldIds?.length ?? 0) > 0);
    }
  });

  if (result.data.inspectImage && !data.images?.some(image => image.handle === result.data.inspectImage!.handle)) {
    fail('unknown_image', 'The model requested an unknown browser image.');
  }

  const tentativeCandidates = (result.data.tentativeCandidates ?? []).filter(candidate => {
    if (candidate.observationIds.some(id => !observations.has(id)) || candidate.sourceIds.some(id => !sources.has(id))) {
      fail('unknown_citation', 'A tentative candidate used missing or unknown evidence identifiers. No result was accepted.');
    }
    const visualEvidence = candidate.visualEvidence ?? [];
    if (visualEvidence.some(reference => !imageIds.has(reference.imageId))) {
      fail('unknown_image', 'A tentative candidate used an image that was not attached to this request. No result was accepted.');
    }
    const hasOcrEvidence = candidate.observationIds.some(id => data.package.observations.some(observation => observation.id === id && observation.origin === 'ocr' && observation.field === 'ocr-line'));
    if (!hasOcrEvidence && !visualEvidence.length) return false;

    const refs = [
      ...candidate.observationIds.map(id => ({ kind: 'observation' as const, id, text: observations.get(id)! })),
      ...candidate.sourceIds.map(id => ({ kind: 'source' as const, id, text: sources.get(id)! })),
    ];
    const tokenizedOcrObservationIds = candidate.observationIds.filter(id => data.package.observations.some(observation =>
      observation.id === id && observation.origin === 'ocr' && observation.field === 'ocr-line' && (observation.ocrWords?.length ?? 0) > 0,
    ));
    if (tokenizedOcrObservationIds.some(id => !candidate.ocrWordEvidence?.some(reference => reference.observationId === id))) return false;

    const seenWordRoles = new Set<string>();
    const wordEvidenceIsValid = (candidate.ocrWordEvidence ?? []).every(reference => {
      const observation = data.package.observations.find(item => item.id === reference.observationId);
      const roleKey = `${reference.observationId}:${reference.role}`;
      if (seenWordRoles.has(roleKey) || !candidate.observationIds.includes(reference.observationId) || !observation
        || observation.origin !== 'ocr' || observation.field !== 'ocr-line' || !observation.imageId
        || !observation.readingOrder || !observation.ocrWords) return false;
      seenWordRoles.add(roleKey);
      const uniqueIndexes = new Set(reference.wordIndexes);
      const orderedIndexes = reference.wordIndexes.every((index, position) =>
        index < observation.ocrWords!.length && (position === 0 || index > reference.wordIndexes[position - 1]),
      );
      if (uniqueIndexes.size !== reference.wordIndexes.length || !orderedIndexes) return false;
      const selectedWords = reference.wordIndexes.map(index => normalizeEvidenceToken(observation.ocrWords![index].text));
      if (selectedWords.some(word => !word)) return false;
      return candidate.supportingSpans.some(span => span.kind === 'observation' && span.id === observation.id && containsOrderedEvidenceTokens(span.quote, selectedWords));
    });

    return wordEvidenceIsValid
      && refs.every(ref => candidate.supportingSpans.some(span => span.kind === ref.kind && span.id === ref.id && ref.text.includes(span.quote)))
      && candidate.supportingSpans.every(span => refs.some(ref => ref.kind === span.kind && ref.id === span.id))
      && visualEvidence.every(reference => imageIds.has(reference.imageId));
  });

  const displayedClaims: typeof supported = [];
  const answerLines: string[] = [];
  for (const claim of supported) {
    const direct = claim.mode === 'direct-quote';
    const visualEvidence = claim.visualEvidence ?? [];
    const sourceQuote = direct && claim.supportingSpans.some(span => span.kind === 'source' && span.quote === claim.text);
    const calculationQuote = direct && claim.supportingSpans.some(span => span.kind === 'calculation' && span.quote === claim.text);
    const profileQuote = direct && claim.supportingSpans.some(span => span.kind === 'profile' && span.quote === claim.text);
    const label = direct ? (sourceQuote ? 'Source excerpt' : calculationQuote ? 'Validated calculation' : profileQuote ? 'User-provided context' : 'Package observation') : visualEvidence.length ? 'Tentative visual interpretation' : 'Evidence-linked interpretation';
    const markers = [
      ...claim.observationIds.map(id => `[observation:${id}]`),
      ...claim.sourceIds.map(id => `[source:${id}]`),
      ...(claim.calculationIds ?? []).map(id => `[calculation:${id}]`),
      ...(claim.profileFieldIds ?? []).map(id => `[profile:${id}]`),
      ...visualEvidence.map(reference => `[image:${reference.imageId}]`),
    ].join(' ');
    const excerptParts = [
      ...claim.supportingSpans.map(span => `“${span.quote}” [${span.kind}:${span.id}]`),
      ...visualEvidence.map(reference => `Gemini-reported visible text (unverified): “${reference.visibleText}” [image:${reference.imageId}]`),
    ];
    const excerpt = direct || !excerptParts.length ? '' : ` Evidence links: ${excerptParts.join(' · ')}`;
    const line = direct ? `${label}: “${claim.text}” ${markers}` : `${label}: ${claim.text}${excerpt} ${markers}`;
    if ([...answerLines, line].join('\n\n').length <= 6800) {
      answerLines.push(line);
      displayedClaims.push(claim);
    }
  }

  const includesVisualInterpretation = displayedClaims.some(claim => (claim.visualEvidence?.length ?? 0) > 0);
  let answer = answerLines.length
    ? `${includesVisualInterpretation ? 'AI-generated interpretation; image-linked text and selected regions are unverified. Inspect the original package before relying on a visual reading.\n\n' : displayedClaims.some(claim => claim.mode === 'synthesis') ? 'AI-generated paraphrase; inspect the exact cited spans below. Citation matches do not verify that the interpretation is entailed.\n\n' : ''}${answerLines.join('\n\n')}`
    : result.data.inspectImage
      ? 'More package evidence is needed. A specific browser image has been requested for inspection.'
      : tentativeCandidates.length
        ? 'I found tentative package readings in the supplied evidence. They remain separate from package facts; OCR-linked interpretations may support clearly labeled arithmetic only after the application checks the cited words, units, basis and layout. Image-only interpretations remain outside calculations.'
      : 'No supported factual conclusion was returned. The available evidence does not establish personal health effects or product safety. Review the package observations or add a relevant source.';
  if (!answer && result.data.inspectImage) answer = 'More package evidence is needed. A specific browser image has been requested for inspection.';

  return {
    claims: displayedClaims,
    tentativeCandidates,
    uiComponents,
    limitations: ['Generated explanations are not independently verified. Tentative candidates never alter original package observations. The application may use a complete OCR-linked candidate only for explicitly labeled arithmetic after checking its evidence and layout; that reading remains unverified. Image-only text and region references stay outside calculations. No diagnosis, medication advice, or safety assessment is provided.'],
    inspectImage: result.data.inspectImage ? { ...result.data.inspectImage, reason: 'A specific package detail may need a closer look. Review the selected image before choosing to send it.' } : null,
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
