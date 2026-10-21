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
