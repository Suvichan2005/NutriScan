import { describe, expect, it } from 'vitest';
import { conversationContextForAssist } from '../conversation-context';
import type { SavedConversationTurn } from '../contracts';

const turns: SavedConversationTurn[] = Array.from({ length: 6 }, (_, index) => ({
  question: `Question ${index + 1}`,
  answer: `Answer ${index + 1}`,
  at: `2026-10-21T00:00:0${index}.000Z`,
}));

describe('conversationContextForAssist', () => {
  it('omits history unless the separate opt-in is enabled', () => {
    expect(conversationContextForAssist(turns, false)).toBeUndefined();
    expect(conversationContextForAssist([], true)).toBeUndefined();
  });

  it('includes only the four newest turns and bounds each field', () => {
    const longTurn = { ...turns[5], question: ` ${'q'.repeat(1200)} `, answer: 'a'.repeat(3000) };
    const context = conversationContextForAssist([...turns.slice(0, 5), longTurn], true);
    expect(context).toHaveLength(4);
    expect(context?.map((turn) => turn.question)).toEqual([
      'Question 3',
      'Question 4',
      'Question 5',
      'q'.repeat(1000),
    ]);
    expect(context?.at(-1)?.question).toHaveLength(1000);
    expect(context?.at(-1)?.answer).toHaveLength(2000);
    expect(context?.every((turn) => !('at' in turn))).toBe(true);
  });
});
