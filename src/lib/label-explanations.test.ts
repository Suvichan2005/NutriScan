import { describe, expect, it } from 'vitest';
import { nutrientExplanation, statementExplanation } from './label-explanations';

describe('label explanation boundaries',()=>{
  it('keeps component declarations separate from precautionary warnings',()=>{
    expect(statementExplanation('contains','CONTAINS OLIGOFRUCTOSE 0.69 g/100 g')?.text).toMatch(/not by itself a warning/i);
    expect(statementExplanation('may-contain','May contain milk')?.text).toMatch(/precautionary/i);
  });
  it('does not treat a claim as verified or carbohydrates as absent',()=>{
    expect(statementExplanation('claim','No added sugar')?.text).toMatch(/Neither means carbohydrate-free/);
    expect(nutrientExplanation('sugars')?.text).toMatch(/less-than sign/i);
    expect(nutrientExplanation('unknown')).toBeNull();
  });
});
