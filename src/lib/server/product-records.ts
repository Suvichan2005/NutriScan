import {z} from 'zod';
import {fixedFetch} from './http';

/** Read-only source sections; never includes image bytes, arbitrary URLs or user data. */
const sections={
 identity:['product_name','product_name_en','product_name_hi','generic_name','brands','quantity','product_quantity','product_quantity_unit','countries_tags','categories_tags','lang','lc'],
 ingredients:['ingredients_text','ingredients_text_en','ingredients_text_hi','ingredients','ingredients_tags','ingredients_analysis_tags','additives_tags','allergens','allergens_tags','traces','traces_tags'],
 nutrition:['nutrition_data_per','nutrition_data_prepared_per','nutrition_data','nutriments','serving_size','serving_quantity','serving_quantity_unit','no_nutrition_data'],
 claims:['labels','labels_tags','ingredients_analysis_tags','packaging_text','conservation_conditions','preparation','warning'],
 quality:['states_tags','data_quality_errors_tags','data_quality_warnings_tags','data_quality_info_tags','completeness','last_editor','sources','tags_sources'],
} as const;
export const productRecordInput=z.object({barcode:z.string().regex(/^\d{8,14}$/),section:z.enum(['identity','ingredients','nutrition','claims','quality']).default('identity'),field:z.string().min(1).max(80).optional(),entryKey:z.string().min(1).max(100).optional(),offset:z.number().int().min(0).max(5000).default(0),limit:z.number().int().min(1).max(12).default(6)}).strict().refine(value=>!value.entryKey||!!value.field,{message:'entryKey requires a selected source field'});
const envelope=z.object({status:z.union([z.number(),z.string()]).optional(),product:z.object({code:z.union([z.string(),z.number()])}).passthrough().optional()}).passthrough();

export function selectProductRecord(raw:unknown,input:z.input<typeof productRecordInput>){
 const args=productRecordInput.parse(input),response=envelope.safeParse(raw);
 if(!response.success)return{status:'invalid_source_response' as const};
 if(!response.data.product)return{status:'no_match' as const};
 const product=response.data.product;
 if(String(product.code)!==args.barcode)return{status:'identity_mismatch' as const};
 const fields=sections[args.section] as readonly string[];
 const common={barcode:args.barcode,section:args.section,sourceUrl:`https://world.openfoodfacts.org/product/${args.barcode}`,apiVersion:'v3',sourceRevision:product.rev??null,lastModifiedUnix:product.last_modified_t??null,retrievedAt:new Date().toISOString(),sourceName:product.product_name??null,availableFields:fields.filter(key=>Object.hasOwn(product,key)),missingFields:fields.filter(key=>!Object.hasOwn(product,key)),license:'Open Food Facts database ODbL; individual contents DbCL. Image licensing is separate; this tool retrieves no images.',limitations:'Community record for this GTIN, not confirmation of the photographed regional formulation or current stock. Missing ingredients/allergen/trace tags do not establish absence. Database normalization and entered units are not necessarily printed label wording. Do not replace package observations or corrections.',nutritionSemantics:'Preserve original nutrient keys and nutrition_data_per/prepared_per. Values as sold and prepared are distinct; *_value follows its declared entry basis, while *_100g and *_serving are normalized source fields. An entered *_unit need not be the printed label unit. serving_quantity is not servings-per-package. Do not infer density or silently change g to ml.'};
 if(!args.field){
  const context:Record<string,unknown>={};const contextFieldsOmitted:string[]=[];let size=0;
  for(const key of fields){if(!Object.hasOwn(product,key))continue;const value=product[key],length=JSON.stringify(value).length;if(Array.isArray(value)||typeof value==='object'||length>3000||size+length>10000){contextFieldsOmitted.push(key);continue;}context[key]=value;size+=length;}
  return{status:'ok' as const,...common,context,contextFieldsOmitted,detailFields:fields.filter(key=>Object.hasOwn(product,key))};
 }
 if(!fields.includes(args.field))return{status:'invalid_field' as const,...common};
 if(!Object.hasOwn(product,args.field))return{status:'no_field' as const,...common,field:args.field};
 const value=product[args.field],kind=Array.isArray(value)?'array':typeof value==='object'&&value!==null?'object':'scalar';
 if(args.entryKey&&kind!=='object')return{status:'invalid_entry_selection' as const,...common};
 const allItems=kind==='array'?value as unknown[]:kind==='object'?Object.entries(value as Record<string,unknown>).map(([key,value])=>({key,value})):[value];
 const objectKeys=kind==='object'?Object.keys(value as Record<string,unknown>):[];
 const availableEntryKeys=kind==='object'?objectKeys.slice(0,200):undefined;
 const items=args.entryKey?allItems.filter(item=>(item as {key:string}).key===args.entryKey):allItems;
 const results:unknown[]=[];let characters=0;
 for(const item of items.slice(args.offset,args.offset+args.limit)){
  const length=JSON.stringify(item).length;
  if(length>12000)return{status:'item_too_large' as const,...common,field:args.field,kind,total:items.length,offset:args.offset,results:[],message:'The complete source item exceeds the bounded tool result; inspect the source. No clipped item is presented.'};
  if(characters+length>18000)break;results.push(item);characters+=length;
 }
 return{status:'ok' as const,...common,field:args.field,kind,availableEntryKeys,entryKeyCount:objectKeys.length,entryKeyIndexIncomplete:objectKeys.length>200,total:items.length,offset:args.offset,nextOffset:args.offset+results.length<items.length?args.offset+results.length:null,results};
}

export async function readProductRecord(input:z.input<typeof productRecordInput>){
 const args=productRecordInput.parse(input);
 if(args.field&&!(sections[args.section] as readonly string[]).includes(args.field))return{status:'invalid_field' as const};
 const url=new URL(`https://world.openfoodfacts.org/api/v3/product/${args.barcode}.json`);
 url.searchParams.set('fields',['code','product_name','rev','last_modified_t',...sections[args.section]].join(','));
 try{return selectProductRecord(await fixedFetch(url,'json',600000),args);}catch{return{status:'unavailable' as const,message:'The external record could not be read. This does not establish absence or package identity.'};}
}
