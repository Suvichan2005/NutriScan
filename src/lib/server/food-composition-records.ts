import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {z} from 'zod';

export const fdcRecordInput=z.object({release:z.enum(['fdc-foundation-2026-04','fdc-fndds-2021-2023']),fdcId:z.number().int().positive(),nutrientId:z.number().int().positive().optional(),field:z.string().min(1).max(100).optional(),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(10).default(3)}).strict().refine(value=>value.nutrientId===undefined||value.field==='foodNutrients',{message:'nutrientId requires foodNutrients field'});
const hashes={'fdc-foundation-2026-04':'27d1fe3fd89edfbe528ed915da5619320e1d004d4594603a1b19bdb1511590cc','fdc-fndds-2021-2023':'2e7eb9fda92adf1d4d784dba5eaa3a7fd4418cd86ccff383c7c9294d79e9b808'};

/** Exact source fields, including unavailable numeric entries and analytical provenance. */
export async function readFoodCompositionSource(input:z.input<typeof fdcRecordInput>,file=path.join(process.cwd(),'.data/food-composition/fdc-source-records.sqlite')){
 const args=fdcRecordInput.parse(input);
 try{const metadata=await stat(file);if(metadata.size>200_000_000)throw new Error('size');}catch(error){return{status:'unavailable' as const,reason:(error as NodeJS.ErrnoException).code==='ENOENT'?'not-imported':'invalid-store'};}
 let db:DatabaseSync|undefined;
 try{
  db=new DatabaseSync(file,{readOnly:true});
  const source=JSON.parse((db.prepare('SELECT metadata FROM sources WHERE id=?').get(args.release) as {metadata:string}).metadata);
  if(source.sourceSha256!==hashes[args.release]||!source.completeObjectEqualityVerified)throw new Error('source');
  const row=db.prepare('SELECT record_json FROM records WHERE release=? AND fdc_id=?').get(args.release,args.fdcId) as {record_json:string}|undefined;
  if(!row)return{status:'no_match' as const,source};
  const record=JSON.parse(row.record_json) as Record<string,unknown>,availableFields=Object.keys(record);
  const common={source,fdcId:args.fdcId,description:record.description,availableFields,basis:'USDA generic food reference; nutrient amounts per 100 g edible portion. Not package facts. Source portion gram weights and amounts are separate.',limitations:'Generic source formulations, populations and recipes may differ from Indian products. Missing amounts are unavailable, not zero. Preserve source units, derivation, sample context and quantification qualifiers; never substitute this reference for photographed label values.'};
  if(!args.field)return{status:'ok' as const,...common,identity:Object.fromEntries(Object.entries(record).filter(([key,value])=>!Array.isArray(value)&&['fdcId','description','dataType','publicationDate','scientificName','startDate','endDate','foodCode','ndbNumber'].includes(key)))};
  if(!Object.hasOwn(record,args.field))return{status:'no_field' as const,...common,field:args.field};
  const value=record[args.field],originalItems=Array.isArray(value)?value:[value];
  const items=args.nutrientId===undefined?originalItems:originalItems.filter(item=>typeof item==='object'&&item!==null&&(item as {nutrient?:{id?:number}}).nutrient?.id===args.nutrientId);
  const results:unknown[]=[];let bytes=0;
  for(const item of items.slice(args.offset,args.offset+args.limit)){
   const size=JSON.stringify(item).length;
   if(size>24000)return{status:'field_too_large' as const,...common,field:args.field,total:items.length,offset:args.offset,results:[],message:'Selected source item exceeds the bounded response. Inspect the original pinned source; no partial object is presented.'};
   if(bytes+size>28000)break;results.push(item);bytes+=size;
  }
  return{status:'ok' as const,...common,field:args.field,total:items.length,offset:args.offset,nextOffset:args.offset+results.length<items.length?args.offset+results.length:null,results};
 }catch{return{status:'unavailable' as const,reason:'invalid-store'};}finally{db?.close();}
}
