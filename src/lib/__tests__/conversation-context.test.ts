import { describe, expect, it } from 'vitest';
import { conversationContextForAssist, resolveLocalFollowUpQuestion } from '../conversation-context';
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

describe('resolveLocalFollowUpQuestion', () => {
  it('carries the user’s WHO fibre topic into a short age-group follow-up', () => {
    const turns = [{ question: 'What does WHO recommend about dietary fibre?', answer: 'A previous unverified answer about something else.', at: '2026-10-21T00:00:00.000Z' }];
    expect(resolveLocalFollowUpQuestion('And for children?', turns)).toBe('What does WHO recommend about dietary fibre? Follow-up: And for children?');
  });

  it('does not borrow assistant answers or unrelated prior questions as evidence', () => {
    const unrelated = [{ question: 'How much sodium is in this package?', answer: 'WHO fibre guidelines say 25 g.', at: '2026-10-21T00:00:00.000Z' }];
    expect(resolveLocalFollowUpQuestion('What about children?', unrelated)).toBe('What about children?');
    expect(resolveLocalFollowUpQuestion('What about children?', [])).toBe('What about children?');
  });

  it('keeps explicit current questions unchanged', () => {
    const turns = [{ question: 'What does WHO recommend about dietary fibre?', answer: 'Prior answer.', at: '2026-10-21T00:00:00.000Z' }];
    expect(resolveLocalFollowUpQuestion('What WHO dietary fibre guidance applies to children?', turns)).toBe('What WHO dietary fibre guidance applies to children?');
  });
});
