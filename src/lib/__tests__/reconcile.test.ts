import {describe,it,expect} from 'vitest';
import {parseLabel} from '../parser';
import {reconcileVision} from '../reconcile';
import {buildAudit} from '../engine';
import {defaultProfile} from '../contracts';
describe('independent image interpretation reconciliation',()=>{
 it('preserves 850 versus 85 and withholds sodium calculation',()=>{const a=parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg',{origin:'ocr'});const b=parseLabel('Snack\nNutrition per 100 g\nSodium 85 mg',{origin:'vision'});const result=reconcileVision(a,b);expect(result.nutrients).toHaveLength(2);expect(result.nutrients.every(n=>n.status==='conflict')).toBe(true);expect(buildAudit(result,30,'g',defaultProfile).calculations).toHaveLength(0);expect(result.observations.some(o=>o.origin==='vision')).toBe(true);});
 it('does not elevate a same-value or incompatible-basis model reading into package fact',()=>{const a=parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg',{origin:'ocr'});const b=parseLabel('Drink\nNutrition per 100 ml\nSodium 85 mg',{origin:'vision'});expect(reconcileVision(a,b).nutrients).toEqual(a.nutrients);expect(reconcileVision(a,b).observations.length).toBeGreaterThan(a.observations.length);});
});
