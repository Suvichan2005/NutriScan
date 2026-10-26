import { evidenceSources } from '@/modules/knowledge';
import { describe, expect, it } from 'vitest';
import { answerEvidenceForConversation, conversationEvidenceForAssist, conversationContextForAssist, resolveLocalFollowUpQuestion } from '../conversation-context';
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

  it('retains declared user context after a package correction without replaying superseded answers', () => {
    const context=conversationContextForAssist([
      {...turns[0],question:'This is for my father; he avoids peanuts. How much protein is in one serving?',answer:'The old reading says 8 g protein.',outdated:true},
      {...turns[1],question:'I corrected the protein value. What about half a serving?',answer:'The corrected calculation is 3 g protein.'},
    ],true);
    expect(context).toEqual([
      {question:'This is for my father; he avoids peanuts. How much protein is in one serving?',answer:''},
      {question:'I corrected the protein value. What about half a serving?',answer:'The corrected calculation is 3 g protein.'},
    ]);
    expect(JSON.stringify(context)).not.toContain('8 g');
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

  it('carries the previous user question into a natural explicit-quantity follow-up', () => {
    const turns = [{ question: 'For my 150 ml portion, what does the sodium mean with hypertension and diabetes?', answer: 'Unverified prior assistant text.', at: '2026-10-21T00:00:00.000Z' }];
    expect(resolveLocalFollowUpQuestion('What if I have 250 ml instead?', turns)).toBe(
      'For my 150 ml portion, what does the sodium mean with hypertension and diabetes? Follow-up: What if I have 250 ml instead?',
    );
  });

  it('does not borrow a prior topic for a new amount without a continuation cue or prior amount', () => {
    expect(resolveLocalFollowUpQuestion('How much protein is in 250 ml?', [{ question: 'How much sodium is in 150 ml?' }])).toBe('How much protein is in 250 ml?');
    expect(resolveLocalFollowUpQuestion('What if I have 250 ml instead?', [{ question: 'What ingredients are listed?' }])).toBe('What if I have 250 ml instead?');
  });

  it('carries context for a quantity-only continuation while leaving new questions explicit', () => {
    const prior = [{ question: 'How much sodium is in 150 ml?', answer: 'Unverified prior assistant text.', at: '' }];
    expect(resolveLocalFollowUpQuestion('And 250 ml?', prior)).toBe('How much sodium is in 150 ml? Follow-up: And 250 ml?');
    expect(resolveLocalFollowUpQuestion('for 250 ml instead.', prior)).toBe('How much sodium is in 150 ml? Follow-up: for 250 ml instead.');
    expect(resolveLocalFollowUpQuestion('How much protein is in 250 ml?', prior)).toBe('How much protein is in 250 ml?');
  });
});

describe('conversationEvidenceForAssist', () => {
  const source=evidenceSources.find(s=>s.id==='who-sodium')!;
  const cited={...turns[0],answer:`See ${source.title}.`,evidence:[source]};
  it('retains cited context without a current-question keyword gate',()=>{
    expect(conversationEvidenceForAssist([cited],true).map(s=>s.id)).toEqual([source.id]);
  });
  it('does not promote an uncited candidate',()=>{
    expect(conversationEvidenceForAssist([{...cited,answer:'A package-only observation.'}],true)).toEqual([]);
  });
  it('excludes outdated, unsafe and non-consented records',()=>{
    expect(conversationEvidenceForAssist([cited],false)).toEqual([]);
    expect(conversationEvidenceForAssist([{...cited,outdated:true}],true)).toEqual([]);
    expect(conversationEvidenceForAssist([{...cited,evidence:[{...source,url:'http://127.0.0.1/private'}]}],true)).toEqual([]);
  });
  it('does not replay sources outside bounded history',()=>{
    expect(conversationEvidenceForAssist([cited,...turns.slice(1)],true)).toEqual([]);
  });
});

describe('answerEvidenceForConversation',()=>{
  const cited=evidenceSources.find(s=>s.id==='who-sodium')!;
  const candidates=evidenceSources.filter(s=>s.id!==cited.id).slice(0,4);
  it('retains a cited record after more than three unused retrieval candidates',()=>{
    expect(answerEvidenceForConversation(`See ${cited.title}.`,[...candidates,cited]).map(s=>s.id)).toEqual([cited.id]);
  });
  it('does not advertise unused candidates as answer citations',()=>{
    expect(answerEvidenceForConversation('This is a package-only observation.',candidates)).toEqual([]);
  });
});
