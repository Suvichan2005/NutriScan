import {describe,it,expect} from 'vitest';
import {getNutritionGuidance} from './nutrition-guidance';
describe('publisher identity versus topic',()=>{
 it('does not retrieve dietary sources from a publisher-like word alone',()=>{
  for(const query of ['Who founded the Mughal Empire?','Who invented the telephone?','American Heart Association office address'])expect(getNutritionGuidance({query})).toEqual([]);
 });
 it('retains applicable named-publisher sodium guidance',()=>{
  expect(getNutritionGuidance({query:'WHO sodium hypertension adult',jurisdiction:'India'}).map(s=>s.id)).toContain('who-sodium');
 });
});
