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
  if (!result.success) fail('provider_invalid', 'The model output failed validation. No result was accepted.');

  const observations = new Map(data.package.observations.map(observation => [observation.id, observation.text]));
  const sources = new Map((data.evidence ?? []).map(source => [source.id, source.summary]));
  const calculations = new Map((data.calculations ?? []).map(calculation => [
    calculation.id,
    calculation.evidenceText ?? calculationEvidenceText(calculation),
  ]));
  const profileFields = new Map(Object.entries(data.profile ?? {}).filter(([, value]) => value.trim().length > 0));

  const supported = result.data.claims.flatMap(claim => {
    if (
      (!claim.observationIds.length && !claim.sourceIds.length && !(claim.calculationIds?.length) && !(claim.profileFieldIds?.length))
      || claim.observationIds.some(id => !observations.has(id))
      || claim.sourceIds.some(id => !sources.has(id))
      || (claim.calculationIds ?? []).some(id => !calculations.has(id))
      || (claim.profileFieldIds ?? []).some(id => !profileFields.has(id))
    ) fail('unknown_citation', 'The model used missing or unknown evidence identifiers. No result was accepted.');

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
    const unsafeMedicalConclusion = /\b(?:safe|unsafe|suitable|unsuitable)\b|\b(?:diagnos(?:e|is)|treat(?:ment)?|cure|medication|medicine|dosage|dose|insulin)\b/i.test(claim.text);
    if (!allRefsHaveExactQuotes || !noUncitedSpan || mode === 'direct-quote' && !literalClaim || mode === 'synthesis' && unsafeMedicalConclusion) return [];
    return [{ ...claim, mode, text: mode === 'direct-quote' ? literalClaim!.quote : claim.text }];
  });

  if (result.data.inspectImage && !data.images?.some(image => image.handle === result.data.inspectImage!.handle)) {
    fail('unknown_image', 'The model requested an unknown browser image.');
  }

  const tentativeCandidates = (result.data.tentativeCandidates ?? []).filter(candidate => {
    if (candidate.observationIds.some(id => !observations.has(id)) || candidate.sourceIds.some(id => !sources.has(id))) {
      fail('unknown_citation', 'A tentative candidate used missing or unknown evidence identifiers. No result was accepted.');
    }
    if (!candidate.observationIds.some(id => data.package.observations.some(observation => observation.id === id && observation.origin === 'ocr' && observation.field === 'ocr-line'))) return false;

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
      && candidate.supportingSpans.every(span => refs.some(ref => ref.kind === span.kind && ref.id === span.id));
  });

  const displayedClaims: typeof supported = [];
  const answerLines: string[] = [];
  for (const claim of supported) {
    const direct = claim.mode === 'direct-quote';
    const sourceQuote = direct && claim.supportingSpans.some(span => span.kind === 'source' && span.quote === claim.text);
    const calculationQuote = direct && claim.supportingSpans.some(span => span.kind === 'calculation' && span.quote === claim.text);
    const profileQuote = direct && claim.supportingSpans.some(span => span.kind === 'profile' && span.quote === claim.text);
    const label = direct ? (sourceQuote ? 'Source excerpt' : calculationQuote ? 'Validated calculation' : profileQuote ? 'User-provided context' : 'Package observation') : 'Evidence-linked interpretation';
    const markers = [
      ...claim.observationIds.map(id => `[observation:${id}]`),
      ...claim.sourceIds.map(id => `[source:${id}]`),
      ...(claim.calculationIds ?? []).map(id => `[calculation:${id}]`),
      ...(claim.profileFieldIds ?? []).map(id => `[profile:${id}]`),
    ].join(' ');
    const excerpt = direct ? '' : ` Evidence spans: ${claim.supportingSpans.map(span => `“${span.quote}” [${span.kind}:${span.id}]`).join(' · ')}`;
    const line = direct ? `${label}: “${claim.text}” ${markers}` : `${label}: ${claim.text}${excerpt} ${markers}`;
    if ([...answerLines, line].join('\n\n').length <= (tentativeCandidates.length ? 3400 : 6800)) {
      answerLines.push(line);
      displayedClaims.push(claim);
    }
  }

  let answer = answerLines.length
    ? `${displayedClaims.some(claim => claim.mode === 'synthesis') ? 'AI-generated paraphrase; inspect the exact cited spans below. Citation matches do not verify that the interpretation is entailed.\n\n' : ''}${answerLines.join('\n\n')}`
    : result.data.inspectImage
      ? 'More package evidence is needed. A specific browser image has been requested for inspection.'
      : 'No supported factual conclusion was returned. The available evidence does not establish personal health effects or product safety. Review the package observations or add a relevant source.';

  if (tentativeCandidates.length) {
    const suggestions = tentativeCandidates.map(candidate => {
      const value = candidate.numericValue === null ? candidate.proposedValue : `${candidate.numericValue}${candidate.unit ? ` ${candidate.unit}` : ''}`;
      const basis = candidate.basis ? ` per ${candidate.basis.amount} ${candidate.basis.unit}` : candidate.kind === 'nutrient' ? '; serving basis unknown' : '';
      const spans = candidate.supportingSpans.slice(0, 3).map(span => `“${span.quote}” [${span.kind}:${span.id}]`).join(' · ');
      return `Tentative model suggestion (${candidate.kind}: ${candidate.field}): ${value}${basis}. ${candidate.uncertainty} Supporting evidence spans: ${spans}. Not verified and not added to package facts.`;
    });
    let combined = `${answer}\n\nUnverified model suggestions — review against the original label:`;
    for (const suggestion of suggestions) {
      const next = `${combined}\n${suggestion}`;
      if (next.length > 7000) break;
      combined = next;
    }
    answer = combined;
  }
  if (!answer && result.data.inspectImage) answer = 'More package evidence is needed. A specific browser image has been requested for inspection.';

  return {
    claims: displayedClaims,
    tentativeCandidates,
    limitations: ['Generated explanations are not independently verified; exact cited evidence spans are provided for inspection. Tentative structured candidates never alter confirmed package observations. No diagnosis, medication advice, or safety assessment is provided.'],
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
