import {expect,it} from 'vitest';
import {parseLabel} from '../../../lib/parser';
import {validateNaturalAnswerText} from '../core';

const context={package:parseLabel('Developer fixture'),question:'Which fields are present?',evidence:[],calculations:[]};
it('does not treat numbers embedded in source identifiers as physical quantities',()=>{
 for(const answer of ['The source has no calcium_100g field.','The energy_prepared_100g field is absent.','The nutrient_100_ml_key is an identifier, not a measured value.']){
  const result=validateNaturalAnswerText(answer,context);
  expect(result.withheldUnsupportedQuantitySentenceCount).toBe(0);
  expect(result.answer).toBe(answer);
 }
});
it('still withholds unsupported quantities beside identifiers and in ordinary prose',()=>{
 for(const answer of ['The calcium_100g value is 500 mg.','The package contains 500 mg calcium.','It provides 500mg per 100g.'])expect(validateNaturalAnswerText(answer,context).withheldUnsupportedQuantitySentenceCount).toBeGreaterThan(0);
});
