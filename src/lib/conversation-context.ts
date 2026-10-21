import type { SavedConversationTurn } from './contracts';

/** Build the bounded, explicitly opted-in context sent with a Gemini assist request. */
export function conversationContextForAssist(
  turns: SavedConversationTurn[],
  include: boolean,
): { question: string; answer: string }[] | undefined {
  if (!include || turns.length === 0) return undefined;
  return turns.slice(-4).map((turn) => ({
    question: turn.question.trim().slice(0, 1000),
    answer: turn.answer.slice(0, 2000),
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
