import {describe,it,expect} from 'vitest';
import {parseLabel} from '../parser';
import {reconcileVision} from '../reconcile';
import {buildAudit} from '../engine';
import {defaultProfile,packageSchema} from '../contracts';
describe('independent image interpretation reconciliation',()=>{
 it('preserves 850 versus 85 and withholds sodium calculation',()=>{const a=parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg',{origin:'ocr'});const b=parseLabel('Snack\nNutrition per 100 g\nSodium 85 mg',{origin:'vision'});const result=reconcileVision(a,b);expect(result.nutrients).toHaveLength(2);expect(result.nutrients.every(n=>n.status==='conflict')).toBe(true);expect(buildAudit(result,30,'g',defaultProfile).calculations).toHaveLength(0);expect(result.observations.some(o=>o.origin==='vision')).toBe(true);});
 it('does not elevate a same-value or incompatible-basis model reading into package fact',()=>{const a=parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg',{origin:'ocr'});const b=parseLabel('Drink\nNutrition per 100 ml\nSodium 85 mg',{origin:'vision'});expect(reconcileVision(a,b).nutrients).toEqual(a.nutrients);expect(reconcileVision(a,b).observations.length).toBeGreaterThan(a.observations.length);});
 it('preserves selected-image and crop provenance on vision observations',()=>{
  const imageId='package-photo-1',runId='vision-run-1';
  const rawObservation={id:'vision-line-1',field:'vision-line',text:'Fibre 8 g',side:'back' as const,confidence:62,origin:'vision' as const,imageId};
  const parsed=parseLabel('Nutrition per 100 g\nFibre 8 g',{origin:'vision',observations:[rawObservation]});
  const capture={runId,imageId,side:'back' as const,sourceImage:{width:1600,height:2400},processing:{rotation:90 as const,contrast:true,invert:false,crop:{x:.1,y:.15,width:.8,height:.7}},model:'gemini-test'};
  const linked=packageSchema.parse({...parsed,visionCaptures:[capture],observations:parsed.observations.map(observation=>observation.id===rawObservation.id?{...observation,visionRunId:runId}:observation)});
  const merged=reconcileVision(parseLabel('Snack\nNutrition per 100 g\nSodium 850 mg',{origin:'ocr'}),linked);
  expect(merged.visionCaptures).toEqual([capture]);
  expect(merged.observations.find(observation=>observation.id===rawObservation.id)).toMatchObject({imageId,visionRunId:runId,origin:'vision'});
  expect(packageSchema.safeParse({...linked,observations:linked.observations.map(observation=>observation.id===rawObservation.id?{...observation,imageId:'different-photo'}:observation)}).success).toBe(false);
 });
});
