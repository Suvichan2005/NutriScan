import type { PackageData, Nutrient } from './contracts';

const amount=(n:Nutrient)=>n.value*(n.unit==='mg'?.001:n.unit==='kJ'?1/4.184:1)/(n.basis?.amount??1);
/** Keep model observations separate; only mark an existing reading disputed. */
export function reconcileVision(original:PackageData,vision:PackageData):PackageData{
 const conflicts=new Set<string>();
 for(const n of original.nutrients)for(const v of vision.nutrients){
  if(n.key===v.key&&n.basis&&v.basis&&n.basis.unit===v.basis.unit&&Math.abs(amount(n)-amount(v))>Math.max(.00001,Math.abs(amount(n))*.02))conflicts.add(n.key);
 }
 const visionCaptures=[...(original.visionCaptures??[]),...(vision.visionCaptures??[])];
 return {...original,observations:[...original.observations,...vision.observations],nutrients:[...original.nutrients.map(n=>conflicts.has(n.key)?{...n,status:'conflict' as const}:n),...vision.nutrients.filter(n=>conflicts.has(n.key)).map(n=>({...n,status:'conflict' as const}))],...(visionCaptures.length?{visionCaptures}:{}),warnings:[...original.warnings,...[...conflicts].map(k=>`${k}: OCR and Gemini image interpretations disagree on a comparable basis. Both remain observations; calculation withheld.`),'Gemini image observations are unverified. Matching numbers do not independently verify the printed label.']};
}
