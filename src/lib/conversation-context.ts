import { calculationSchema, type Calculation, type PackageData, type SavedConversationTurn } from './contracts';
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
 * Resolve one explicit age-group follow-up from the preceding user question.
 * Prior assistant text is deliberately ignored; it is conversational context,
 * not evidence. Only the supported WHO fibre-guidance topic is carried forward.
 */
export function resolveLocalFollowUpQuestion(
  question: string,
  previousTurns: Pick<SavedConversationTurn, 'question'>[],
): string {
  const current = question.trim();
  const ageFollowUp = /^(?:(?:and|what|how)\s+)?(?:(?:about|for)\s+)?(?:the\s+)?(?:children|kids|adults)\b[\s\S]*$/i.test(current);
  if (!ageFollowUp) return current;

  const previousQuestion = previousTurns.at(-1)?.question.trim() ?? '';
  const previousAskedWholeDietFibre = /\b(?:dietary\s+)?fib(?:er|re)\b/i.test(previousQuestion)
    && /\b(?:WHO|guideline|recommend\w*|guidance|daily|per day)\b/i.test(previousQuestion);
  if (!previousAskedWholeDietFibre) return current;

  return `${previousQuestion.slice(0, 1000)} Follow-up: ${current.slice(0, 1000)}`;
}
