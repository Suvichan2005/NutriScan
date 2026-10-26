import {it,expect} from 'vitest';
import {parseLabel} from '../../../lib/parser';
import {validateNaturalAnswerText} from '../core';
import type {EvidenceSource} from '../../../lib/contracts';
import {evidenceSources} from '../../knowledge';
const context={package:parseLabel('Developer fixture; composition unknown.'),question:'For a fictional adult with type 2 diabetes, explain what is needed.',evidence:[]as EvidenceSource[],calculations:[]};

it('retains measurement-basis explanations without turning denominators into food amounts',()=>{
 for(const text of ['Check the sodium unit and whether the basis is per 100g/100ml or per serving.','A basis may be per 100 g (or 100 ml).','Find the serving size, in grams per serving, before calculating the amount eaten.','Whether the amounts are per serving or per container matters.']){
  const result=validateNaturalAnswerText(text,context);expect(result.withheldUnsupportedQuantitySentenceCount).toBe(0);expect(result.answer).toBe(text);
 }
 for(const text of ['The label lists sodium 100 mg per 100 g.','It contains 100 g carbohydrate.','The product contains 0 g sugar per serving.','The label is per 300 g.','Each serving contains 100 ml.'])expect(validateNaturalAnswerText(text,context).withheldUnsupportedQuantitySentenceCount).toBeGreaterThan(0);
});

it('keeps exact user numeral identifiers attached to their words and separate from quantities',()=>{
 for(const [question,answer]of [['For type 2 diabetes, explain the label.','The user stated type 2 diabetes.'],['I use version 4.','This discussion uses version 4.'],['The user calls this grade 3.','The user supplied grade 3.']]){
  expect(validateNaturalAnswerText(answer,{...context,question}).withheldUnsupportedQuantitySentenceCount).toBe(0);
 }
 for(const text of ['It contains 2 g sugar.','There are 2 participants.','The user has type 3 diabetes.','There are 2 servings per pack.','It provides 2 per serving.'])expect(validateNaturalAnswerText(text,context).withheldUnsupportedQuantitySentenceCount).toBeGreaterThan(0);
 expect(validateNaturalAnswerText('This is for 2 participants.',{...context,question:'Please calculate for 2 servings.'}).withheldUnsupportedQuantitySentenceCount).toBeGreaterThan(0);
});

const source:EvidenceSource={id:'developer-reference',title:'Developer source',publisher:'Developer',url:'https://example.test/reference',category:'guideline',jurisdiction:'Synthetic',publishedAt:null,effectiveAt:null,retrievedAt:'2026-10-26',summary:'A source amount is 12 g per serving. The source reference is at least 25 g per day.',limitations:'Developer numerical fixture, not dietary guidance.'};
it('keeps the printed basis mandatory when an actual amount is asserted',()=>{
 const ctx={...context,evidence:[source]};
 expect(validateNaturalAnswerText('The amount is 12 g per serving.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(0);
 for(const text of ['The amount is 12 g per 100 g.','The amount is 12 g per 100ml.','The amount is 12 g per pack.','The amount is 12 per 100 g.'])expect(validateNaturalAnswerText(text,ctx).withheldUnsupportedQuantitySentenceCount).toBeGreaterThan(0);
});
it('recognizes a prefixed daily rate without dropping the comparator or accepting a changed denominator',()=>{
 const ctx={...context,evidence:[source]};
 expect(validateNaturalAnswerText('The daily intake reference is at least 25 g.',ctx).withheldUnsupportedQuantitySentenceCount).toBe(0);
 for(const text of ['The daily intake reference is more than 25 g.','The intake reference is at least 25 g per week.','The daily intake reference is at least 250 g.'])expect(validateNaturalAnswerText(text,ctx).withheldUnsupportedQuantitySentenceCount).toBeGreaterThan(0);
});

it('matches unitless study counts to the same named subject despite changed sentence connectors',()=>{
 const review:EvidenceSource={...source,id:'review-counts',title:'Review',summary:'The meta-analysis included 13 trials with 927 participants.',publishedAt:'2022-05-13'};
 const ctx={...context,evidence:[review]};
 const supported='A 2022 systematic review included 13 trials and 927 participants.';
 expect(validateNaturalAnswerText(supported,ctx).answer).toBe(supported);
 const full='Clinical research and meta-analyses (such as a 2022 systematic review published in Clinical Nutrition ESPEN evaluating 13 trials and 927 participants) indicate that sufficient daily intakes can affect lipids.';
 expect(validateNaturalAnswerText(full,ctx).answer).toBe(full);
 for(const wrong of ['A 2022 systematic review included 13 participants and 927 trials.','A 2022 systematic review included 14 trials and 927 participants.','A 2022 systematic review included 13 trials and 928 participants.'])
  expect(validateNaturalAnswerText(wrong,ctx).withheldUnsupportedQuantitySentenceCount).toBe(1);
});

it('retains the saved PubMed study-count sentence without admitting adjacent unsupported quantities',()=>{
 const review=evidenceSources.find(item=>item.id==='pubmed-oat-beta-glucan-lipids-2022')!;
 const answer='Clinical research and meta-analyses (such as a 2022 systematic review published in *Clinical Nutrition ESPEN* evaluating 13 trials and 927 participants) indicate that sufficient daily intakes of oat beta-glucan can help reduce total and LDL cholesterol.';
 const result=validateNaturalAnswerText(answer,{...context,evidence:[review]});
 expect(result.withheldUnsupportedQuantitySentenceCount).toBe(0);
 expect(result.answer).toBe(answer);
 for(const unsupported of [
  'The reading is 12.4 g per 100 g, or approximately 4.7 g per 38 g serving.',
  'A cholesterol-lowering claim typically requires at least 1 g of beta-glucan per serving.',
 ])expect(validateNaturalAnswerText(unsupported,{...context,evidence:[review]}).withheldUnsupportedQuantitySentenceCount).toBe(1);
});
