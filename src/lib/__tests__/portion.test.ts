import { describe, expect, it } from 'vitest';
import { resolveQuestionPortion } from '../portion';

describe('question-directed portions',()=>{
  it('uses the amount and unit in a first or follow-up question',()=>{
    expect(resolveQuestionPortion('How much sodium is in 50 g?',{value:30,unit:'g'})).toEqual({value:50,unit:'g'});
    expect(resolveQuestionPortion('What about 250 ml?',{value:30,unit:'g'})).toEqual({value:250,unit:'ml'});
  });
  it('uses half the declared pack when requested',()=>{
    expect(resolveQuestionPortion('How about half a pack?',{value:30,unit:'g'},{value:200,unit:'g'})).toEqual({value:100,unit:'g'});
  });
  it('keeps the current portion when the question has no supported amount',()=>{
    expect(resolveQuestionPortion('What is this ingredient?',{value:45,unit:'ml'})).toEqual({value:45,unit:'ml'});
    expect(resolveQuestionPortion('Is 3000 g still supported?',{value:45,unit:'ml'})).toEqual({value:45,unit:'ml'});
  });
});
