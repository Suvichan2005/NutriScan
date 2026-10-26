import {expect,it} from 'vitest';import {parseLabel} from '../../../lib/parser';import {validateNaturalAnswerText} from '../core';import type {EvidenceSource} from '../../../lib/contracts';
const source:EvidenceSource={id:'developer-formatting-fixture',title:'Developer numeric formatting fixture',publisher:'Developer test',url:'https://example.test/source',category:'guideline',jurisdiction:'Synthetic only',publishedAt:null,effectiveAt:null,retrievedAt:'2026-10-25',summary:'At least 25 g per day. Less than 2000 mg per day.',limitations:'Developer test, not dietary advice.'};const context={package:parseLabel('Developer fixture'),question:'Show the source values.',evidence:[source],calculations:[],sourceIdsForSentence:()=>[source.id]};
it('validates numerical meaning independently of paired strong-emphasis formatting',()=>{for(const text of ['At least **25 g per day**.','At least **25 g** per day.','At least __25 g per day__.','Less than **2000 mg per day**.']){const result=validateNaturalAnswerText(text,context);expect(result.withheldUnsupportedQuantitySentenceCount).toBe(0);expect(result.answer).toBe(text);}});
it('still rejects changed comparators, time bases and quantities in formatted prose',()=>{for(const text of ['More than **25 g per day**.','At least **25 g per week**.','At least **250 g per day**.','Less than **2000 mg per week**.'])expect(validateNaturalAnswerText(text,context).withheldUnsupportedQuantitySentenceCount).toBe(1);});

it('keeps explicitly supplied age context separate from measured food quantities',()=>{const ctx={...context,question:'For a fictional 7-year-old, explain the evidence.'};expect(validateNaturalAnswerText('For a 7-year-old, the evidence has age-specific scope.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(0);expect(validateNaturalAnswerText('For an 8-year-old, the evidence applies.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(1);expect(validateNaturalAnswerText('It contains 7 g of carbohydrate.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(1);expect(validateNaturalAnswerText('The trial ran for 7 years.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(1);});

const measurementContext={...context,evidence:[{...source,summary:'Measured changes were -1.7 kg, -3.2 cm and -0.8%. A separate length was 42 cm. The reported p < 0.002. A reference was at most 40 mg per day.'}]};
it('compares flat TeX units and escaped percentages without changing displayed prose',()=>{
  for(const text of [String.raw`The changes were $-1.7\text{ kg}$, $-3.2\mathrm{cm}$ and $-0.8\%$.`,String.raw`The reference is $\leq 40\text{ mg}$ per day.`]){
    const result=validateNaturalAnswerText(text,measurementContext);expect(result.withheldUnsupportedQuantitySentenceCount).toBe(0);expect(result.answer).toBe(text);
  }
});
it('preserves signs, dimensions, comparison operators and time bases through presentation normalization',()=>{
  for(const text of [String.raw`The change was $1.7\text{ kg}$.`,String.raw`The change was $-3.2\text{ kg}$.`,String.raw`The reference is $\geq 40\text{ mg}$ per day.`,String.raw`The reference is $\leq 40\text{ mg}$ per week.`])expect(validateNaturalAnswerText(text,measurementContext).withheldUnsupportedQuantitySentenceCount).toBe(1);
});
it('supports SI length conversion independently of mass and numeric presentation',()=>{
  for(const text of ['The separate length was 0.42 m.','The separate length was 420 mm.','The change was -32 mm.'])expect(validateNaturalAnswerText(text,measurementContext).withheldUnsupportedQuantitySentenceCount).toBe(0);
  for(const text of ['The change was -0.32 m.','The change was -3.2 mm.','The change was -3.2 g.'])expect(validateNaturalAnswerText(text,measurementContext).withheldUnsupportedQuantitySentenceCount).toBe(1);
});
it('does not confuse case-sensitive concentration symbols with SI length',()=>{
  const ctx={...context,evidence:[{...source,summary:'A synthetic source records 4 mM and 8 cm.'}]};
  expect(validateNaturalAnswerText('It records 4 mM.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(0);
  for(const text of ['It records 4 mm.','It records 4 m.','It records 4.','It records 8 cM.'])expect(validateNaturalAnswerText(text,ctx).withheldUnsupportedQuantitySentenceCount).toBe(1);
});
