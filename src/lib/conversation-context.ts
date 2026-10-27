import { selectCitedEvidence } from './answer-evidence';
import { safeConversationEvidence } from './followup-evidence';
import { calculationSchema, type Calculation, type EvidenceSource, type PackageData, type SavedConversationTurn } from './contracts';
import { calculationHasPackageEvidence } from './calculation-provenance';

/** Reuse typed operations, never numeric assertions copied from previous prose. */
export function conversationCalculationsForAssist(turns: SavedConversationTurn[], pkg: PackageData): Calculation[] {
  const observationIds = new Set(pkg.observations.map(item => item.id));
  const imageIds = new Set([
    ...pkg.observations.flatMap(item => item.imageId ? [item.imageId] : []),
    ...(pkg.ocrCaptures ?? []).map(item => item.imageId),
    ...(pkg.visionCaptures ?? []).map(item => item.imageId),
  ]);
  const results = new Map<string, Calculation>();
  for (const turn of turns.slice(-4).reverse()) {
    if (turn.outdated) continue;
    for (const value of turn.calculations ?? []) {
      const parsed = calculationSchema.safeParse(value);
      if (!parsed.success) continue;
      const calculation = parsed.data;
      if (calculation.observationIds.some(id => !observationIds.has(id))
        || calculation.imageIds?.some(id => !imageIds.has(id))
        || !calculationHasPackageEvidence(calculation, { package: pkg })) continue;
      const key = JSON.stringify([calculation.nutrient, calculation.nutrientLabel, calculation.input, calculation.inputUnit,
        calculation.basisAmount, calculation.portion, calculation.portionUnit, calculation.result, calculation.unit,
        [...(calculation.interpretationIds ?? [])].sort()]);
      // Legacy local operations reuse IDs across portions. Give historical
      // operations request-local IDs while retaining every source reference.
      if (!results.has(key)) results.set(key, { ...calculation, id: `history-${results.size}-${calculation.id.slice(0, 100)}` });
      if (results.size === 20) return [...results.values()];
    }
  }
  return [...results.values()];
}

/** Build the bounded, explicitly opted-in context sent with a Gemini assist request. */
export function conversationContextForAssist(
  turns: SavedConversationTurn[],
  include: boolean,
): { question: string; answer: string }[] | undefined {
  if (!include || turns.length === 0) return undefined;
  return turns.slice(-4).map((turn) => ({
    question: turn.question.trim().slice(0, 1000),
    // A package revision invalidates the assistant's earlier conclusions,
    // not the user's question or the context they explicitly supplied.
    answer: turn.outdated ? '' : turn.answer.slice(0, 2000),
  }));
}

/**
 * Resolve supported quantity changes and explicit referential follow-ups from
 * the preceding user question. Prior assistant text is deliberately ignored:
 * conversational context can retain what the user said, but is not evidence.
 */
export function resolveLocalFollowUpQuestion(
  question: string,
  previousTurns: Pick<SavedConversationTurn, 'question'>[],
): string {
  const current = question.trim();
  const explicitMassOrVolume = /\b\d+(?:\.\d+)?\s*(?:g|grams?|ml|millilit(?:er|re)s?)\b/i;
  const amountOnlyFollowUp = /^(?:(?:and|or)\s+)?(?:(?:for|at|with)\s+)?\d+(?:\.\d+)?\s*(?:g|grams?|ml|millilit(?:er|re)s?)(?:\s+instead)?[?.!,]*$/i.test(current);
  const continuesPriorAmount = amountOnlyFollowUp
    || /^(?:(?:and\s+)?(?:what|how)\s+about\b|what\s+if\b|and\s+if\b)/i.test(current)
    || /\binstead\b/i.test(current);
  const previousQuestion = previousTurns.at(-1)?.question.trim() ?? '';
  if (continuesPriorAmount && explicitMassOrVolume.test(current) && explicitMassOrVolume.test(previousQuestion)) {
    return `${previousQuestion.slice(0, 1000)} Follow-up: ${current.slice(0, 1000)}`;
  }

  // In this workspace “this” refers to the active package. Borrowing the prior
  // question here can turn a new package question into an unrelated nutrient query.
  const explicitReferenceFollowUp = /^(?:(?:and\s+)?(?:would|will|can|could|does|is)\s+(?:that|it|those|they|them)\b|(?:and\s+)?(?:what|how)\s+(?:would|will|can|could|does)\s+(?:that|it|those|they|them)\b|(?:and\s+)?(?:what|how)\s+about\s+(?:that|it|those|them)\b)/i.test(current);
  if (explicitReferenceFollowUp && previousQuestion) {
    return `${previousQuestion.slice(0, 1000)} Follow-up: ${current.slice(0, 1000)}`;
  }

  const ageFollowUp = /^(?:(?:and|what|how)\s+)?(?:(?:about|for)\s+)?(?:the\s+)?(?:children|kids|adults)\b[\s\S]*$/i.test(current);
  if (!ageFollowUp) return current;

  const previousAskedWholeDietFibre = /\b(?:dietary\s+)?fib(?:er|re)\b/i.test(previousQuestion)
    && /\b(?:WHO|guideline|recommend\w*|guidance|daily|per day)\b/i.test(previousQuestion);
  if (!previousAskedWholeDietFibre) return current;

  return `${previousQuestion.slice(0, 1000)} Follow-up: ${current.slice(0, 1000)}`;
}

/** Carry bounded cited records as context, not as new findings or clinical authority.
 * The model and server applicability checks see the current question AND history.
 * A short follow-up must not discard its references through a question-only gate.
 */
export function conversationEvidenceForAssist(turns: SavedConversationTurn[], include: boolean) {
  if (!include) return [];
  return safeConversationEvidence(turns.slice(-4).reverse().filter(turn => !turn.outdated)
    .flatMap(turn => selectCitedEvidence(turn.answer, turn.evidence ?? [])));
}

/** Apply citation selection BEFORE the bounded chat persistence limit.
 * Retrieval candidates are not automatically evidence used by the answer.
 */
export function answerEvidenceForConversation(answer: string, sources: readonly EvidenceSource[]) {
  return safeConversationEvidence(selectCitedEvidence(answer, sources));
}
