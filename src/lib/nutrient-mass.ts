import type {NutrientKey,PackageReconstructionContent} from './contracts';

// Actual mass constituents, not energy or salt-equivalent declarations. No
// density is assumed for volume bases and no unknown nutrient is classified.
const massConstituents=new Set<NutrientKey>(['carbohydrate','sugars','addedSugars','protein','fat','saturatedFat','fiber','sodium']);
const grams:Record<string,number>={g:1,mg:.001,'µg':.000001,'μg':.000001,mcg:.000001,ug:.000001};
type Reading={nutrientKey?:NutrientKey|null;value:number|null;unit:string|null;basisAmount:number|null;basisUnit:'g'|'ml'|null;qualifier?:string|null};
/** A dimensional impossibility check, never a reconstruction of missing digits. */
export function nutrientMassConflict(row:Reading):string|null{
 if(!row.nutrientKey||!massConstituents.has(row.nutrientKey)||row.value===null||row.unit===null||row.basisUnit!=='g'||!row.basisAmount||!grams[row.unit])return null;
 if(row.qualifier&&!['>','>='].includes(row.qualifier))return null;
 const mass=row.value*grams[row.unit],epsilon=Number.EPSILON*32*Math.max(1,mass,row.basisAmount);
 if(mass>row.basisAmount+epsilon||(row.qualifier==='>'&&mass>=row.basisAmount-epsilon))return `The nutrient amount (${row.value} ${row.unit}) exceeds the total reference mass (${row.basisAmount} g). Retain the reading for review; do not calculate from it.`;
 return null;
}

export function checkReconstructionMasses(content:PackageReconstructionContent){
 const issues=content.nutritionRows.flatMap(row=>{const reason=nutrientMassConflict(row);return reason?[{rowId:row.rowId,reason,evidence:row.evidence}]:[];});
 if(!issues.length)return {content,issues};
 const conflicts=new Set(issues.map(issue=>issue.rowId));
 return {issues,content:{...content,nutritionRows:content.nutritionRows.map(row=>conflicts.has(row.rowId)?{...row,status:'conflict' as const}:row),unresolved:[...content.unresolved,...issues.filter(issue=>!content.unresolved.some(item=>item.field===issue.rowId.slice(0,120)&&item.reason===issue.reason)).map(issue=>({field:issue.rowId.slice(0,120),reason:issue.reason,evidence:issue.evidence}))].slice(0,100)}};
}
