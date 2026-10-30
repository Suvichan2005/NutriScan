import { describe, expect, it } from 'vitest';
import { conversationAnswerBlocks, presentConversationAnswer, separateLegacyAnswerNotice } from '../conversation-answer';

describe('presentConversationAnswer', () => {
  it('preserves single-newline paragraphs, lists and caveats without selecting claims', () => {
    const blocks = conversationAnswerBlocks('A qualified recommendation.\nHere is why:\n- First reason.\n- Second reason.\nThis uncertainty affects the answer.');
    expect(blocks.map(block => block.text)).toEqual(['A qualified recommendation.', 'Here is why:', '• First reason.\n• Second reason.', 'This uncertainty affects the answer.']);
  });
  it('separates only an exact old application footer, preserving medical caveats and model wording', () => {
    const notice = 'I omitted one or more numerical statements that the available evidence could not verify. Some numbers are provisional package readings; confirm them in Package details.';
    const body = 'A qualified recommendation.\n\nKeep the important uncertainty in view.';
    expect(separateLegacyAnswerNotice(`${body}\n\n${notice}`)).toEqual({ answer: body, withheld: true, provisional: true });
    expect(separateLegacyAnswerNotice(`${notice}\n\n${body}`).answer).toBe(`${notice}\n\n${body}`);
    expect(separateLegacyAnswerNotice(`${body}\n\nSome label numbers may be wrong.`).answer).toContain('Some label numbers may be wrong.');
  });
  it('hides internal evidence identifiers while preserving the grounded answer and paragraph breaks', () => {
    const answer = 'Label reading: Protein 3 g [observation:protein-1] Evidence links: “Protein 3 g” [observation:protein-1]\n\nSource finding: JECFA record [source:jecfa-1] [source:jecfa-1]';
    expect(presentConversationAnswer(answer)).toBe('Label reading: Protein 3 g\n\nSource finding: JECFA record');
  });

  it('removes empty comma-only citation placeholders without changing bracketed label identifiers',()=>{
    expect(presentConversationAnswer('Two biscuits provide 9.28 g carbohydrate [,,, ]. This additive is INS [INS 319].'))
      .toBe('Two biscuits provide 9.28 g carbohydrate. This additive is INS [INS 319].');
  });

  it('presents common Gemini Markdown as readable conversation text',()=>{
    expect(presentConversationAnswer('## Printed values\n\n- **Energy:** 139 kcal\n- **Carbohydrate:** 23.1 g\n\n*(Approximate values.)*'))
      .toBe('Printed values\n\n• Energy: 139 kcal\n• Carbohydrate: 23.1 g\n\n(Approximate values.)');
  });
  it('cleans malformed heading emphasis while preserving footnotes, comparisons and multiplication',()=>{
    expect(presentConversationAnswer('**Limitations:*\nThe value is <0.5 g.\nAverage values*\n2 * 3 = 6'))
      .toBe('Limitations:\nThe value is <0.5 g.\nAverage values*\n2 * 3 = 6');
    expect(presentConversationAnswer('**Limitations:* This is not individual medical advice.'))
      .toBe('Limitations: This is not individual medical advice.');
  });
});
