import {packageReconstructionContentSchema,type PackageReconstructionContent} from '../contracts';

const shape=packageReconstructionContentSchema.shape;
const sections={quantityDeclarations:shape.quantityDeclarations.unwrap(),nutritionRows:shape.nutritionRows,ingredients:shape.ingredients,additives:shape.additives,statements:shape.statements,regions:shape.regions,unresolved:shape.unresolved};
type Rejection={section:keyof typeof sections;index:number|null;issues:{path:string;code:string}[]};

const nullableTextFields={
 quantityDeclarations:['printedText','unit'],
 nutritionRows:['nutrientKey','printedValue','unit','columnLabel','basisText','qualifier'],
 ingredients:['normalizedName'],
 additives:['code','normalizedName'],
 statements:['label'],
 regions:[],
 unresolved:[],
} satisfies Record<keyof typeof sections,string[]>;

function normalizeNullSentinels(value:unknown,fields:readonly string[]):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const record=value as Record<string,unknown>;
 const normalized={...record};
 for(const field of fields){
  const fieldValue=normalized[field];
  if(typeof fieldValue==='string'&&/^(?:null|undefined)$/i.test(fieldValue.trim()))normalized[field]=null;
 }
 return normalized;
}

function isBoundedQualifier(value:string|null){
 const qualifier=value?.trim().toLocaleLowerCase('en-US');
 return qualifier==='<'||qualifier==='>'||qualifier==='≤'||qualifier==='≥'||qualifier==='<='||qualifier==='>='
  ||qualifier==='less than'||qualifier==='less than or equal to'||qualifier==='greater than'||qualifier==='greater than or equal to';
}

function displayedRoundingTolerance(printedValue:string|null){
 const match=printedValue?.trim().match(/^\d+(?:\.(\d+))?$/);
 return match?0.5*10**-(match[1]?.length??0):0;
}

/** Preserve source values, but do not present a cross-basis bound as an exact result. */
function flagRowsAtScaledBounds(candidate:Record<string,unknown>){
 if(!Array.isArray(candidate.nutritionRows)||!Array.isArray(candidate.unresolved))return;
 const rows=candidate.nutritionRows as PackageReconstructionContent['nutritionRows'];
 const unresolved=candidate.unresolved as PackageReconstructionContent['unresolved'];
 const flagged=new Map<number,Set<string>>();
 for(let i=0;i<rows.length;i++){
  const bounded=rows[i];
  if(!isBoundedQualifier(bounded.qualifier)||bounded.value===null||!bounded.basisAmount||!bounded.basisUnit||!bounded.unit||!['clear','provisional'].includes(bounded.status))continue;
  for(let j=0;j<rows.length;j++){
   if(i===j)continue;
   const exact=rows[j];
   const sameNutrient=bounded.nutrientKey&&exact.nutrientKey
    ?bounded.nutrientKey===exact.nutrientKey
    :bounded.printedLabel.trim().normalize('NFKC').toLocaleLowerCase('en-US')===exact.printedLabel.trim().normalize('NFKC').toLocaleLowerCase('en-US');
   if(!sameNutrient||exact.value===null||exact.qualifier!==null||exact.unit!==bounded.unit||exact.basisUnit!==bounded.basisUnit
    ||!exact.basisAmount||exact.basisAmount===bounded.basisAmount||!['clear','provisional'].includes(exact.status))continue;
   const scaledBound=bounded.value*exact.basisAmount/bounded.basisAmount;
   const tolerance=Math.max(displayedRoundingTolerance(exact.printedValue),Number.EPSILON*Math.max(1,Math.abs(scaledBound),Math.abs(exact.value))*8);
   if(Math.abs(exact.value-scaledBound)<=tolerance)flagged.set(j,new Set([...(flagged.get(j)??[]),bounded.rowId]));
  }
 }
 for(const [index,relatedRows]of flagged){
  const row=rows[index];
  if(row.status==='ambiguous')continue;
  rows[index]={...row,status:'ambiguous'};
  const evidenceRows=[row,...rows.filter(candidateRow=>relatedRows.has(candidateRow.rowId))];
  const observations=[...new Set(evidenceRows.flatMap(item=>item.evidence?.observationIds??[]))];
  const regionMap=new Map<string,(typeof evidenceRows)[number]['evidence']['imageRegions'][number]>();
  for(const item of evidenceRows)for(const region of item.evidence?.imageRegions??[])regionMap.set(`${region.imageId}|${JSON.stringify(region.region)}`,region);
  unresolved.push({
   field:`nutrition:${row.printedLabel}`,
   reason:'An exact-looking nutrition reading is at or within its displayed rounding precision of a bounded reading for the same nutrient at another printed basis. Both readings are preserved for review; automated calculations should not treat the exact-looking value as established.',
   evidence:{observationIds:observations,imageRegions:[...regionMap.values()]},
  });
 }
 candidate.nutritionRows=rows;
 candidate.unresolved=unresolved;
}

/** Validate independent repeated entries without changing a number, unit or source. */
export function validateReconstructionSections(value:unknown){
 const rejected:Rejection[]=[];
 if(!value||typeof value!=='object'||Array.isArray(value))return{parsed:packageReconstructionContentSchema.safeParse(value),rejected};
 const candidate={...value as Record<string,unknown>};
 candidate.identity=normalizeNullSentinels(candidate.identity,['brand','name','variant']);
 candidate.serving=candidate.serving===null?null:normalizeNullSentinels(candidate.serving,['printedText','unit','pieceDescription']);
 for(const [name,schema] of Object.entries(sections) as [keyof typeof sections,(typeof sections)[keyof typeof sections]][]){
  if(name==='quantityDeclarations'&&candidate[name]===undefined)continue;
  if(Array.isArray(candidate[name]))candidate[name]=(candidate[name] as unknown[]).map(item=>normalizeNullSentinels(item,nullableTextFields[name]));
  const collection=schema.safeParse(candidate[name]);
  if(collection.success){candidate[name]=collection.data;continue;}
  // Wrong container types and over-limit arrays are rejected as a section;
  // filtering must never evade the shared contract's resource limits.
  if(!Array.isArray(candidate[name])||collection.error.issues.some(issue=>issue.path.length===0)){
   rejected.push({section:name,index:null,issues:collection.error.issues.slice(0,20).map(issue=>({path:issue.path.map(String).join('.'),code:issue.code}))});candidate[name]=[];continue;
  }
  const accepted:unknown[]=[];
  for(const [index,entry]of(candidate[name] as unknown[]).entries()){
   const result=schema.element.safeParse(entry);
   if(result.success)accepted.push(result.data);
   else rejected.push({section:name,index,issues:result.error.issues.slice(0,20).map(issue=>({path:issue.path.map(String).join('.'),code:issue.code}))});
  }
  candidate[name]=accepted;
 }
 flagRowsAtScaledBounds(candidate);
 // Required singleton fields and the complete canonical result remain strict.
 return{parsed:packageReconstructionContentSchema.safeParse(candidate),rejected};
}
