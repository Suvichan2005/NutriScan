import { describe, expect, it } from 'vitest';
import { presentConversationAnswer } from '../conversation-answer';

describe('presentConversationAnswer', () => {
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
});
