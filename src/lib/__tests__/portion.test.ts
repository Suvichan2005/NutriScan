import { describe, expect, it } from 'vitest';
import { defaultPortion, resolveQuestionPortion } from '../portion';

describe('neutral reference amount',()=>{
  it('uses an explicitly declared package serving first',()=>{
    expect(defaultPortion({serving:{value:45,unit:'g'},nutrients:[{status:'observed',basis:{amount:100,unit:'g'}}]})).toEqual({value:45,unit:'g'});
  });
  it('uses a clear label basis when the package gives no serving',()=>{
    expect(defaultPortion({nutrients:[{status:'observed',basis:{amount:100,unit:'ml'}}]})).toEqual({value:100,unit:'ml'});
    expect(defaultPortion({nutrients:[{status:'observed',basis:{amount:25,unit:'g'}}]})).toEqual({value:25,unit:'g'});
  });
  it('does not choose a serving amount with the wrong dimension for the label basis',()=>{
    expect(defaultPortion({serving:{value:200,unit:'ml'},nutrients:[{status:'observed',basis:{amount:100,unit:'g'}}]})).toEqual({value:100,unit:'g'});
  });
  it('uses a standardized reference when the label declares neither',()=>{
    expect(defaultPortion({netWeight:{value:750,unit:'ml'},nutrients:[]})).toEqual({value:100,unit:'ml'});
    expect(defaultPortion({nutrients:[]})).toEqual({value:100,unit:'g'});
  });
  it('does not use a conflicted nutrient basis as the default',()=>{
    expect(defaultPortion({nutrients:[{status:'conflict',basis:{amount:30,unit:'g'}}]})).toEqual({value:100,unit:'g'});
  });
});

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
