import {packageReconstructionContentSchema} from '../contracts';

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
 // Required singleton fields and the complete canonical result remain strict.
 return{parsed:packageReconstructionContentSchema.safeParse(candidate),rejected};
}
