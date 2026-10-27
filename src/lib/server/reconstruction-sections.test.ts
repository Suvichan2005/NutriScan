import{expect,it}from'vitest';
import{validateReconstructionSections}from'./reconstruction-sections';
import{sanitizePackageReconstruction,assistInput}from'./gemini';
import{packageSchema}from'../contracts';
const evidence={observationIds:['ocr'],imageRegions:[]};
const row={rowId:'r1',nutrient:'Protein',nutrientKey:'protein',printedLabel:'Protein',printedValue:'8.8',value:8.8,unit:'g',columnLabel:'Per 100 g',basisText:'Per 100 g',basisAmount:100,basisUnit:'g',qualifier:null,status:'clear',evidence};
const content={identity:{name:null,brand:null,variant:null,status:'unreadable',evidence},serving:null,nutritionRows:[row],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Synthetic boundary fixture, not independent product truth.'};
const input=assistInput.parse({consent:true,question:'Read this fixture',package:packageSchema.parse({id:'fixture',name:'Unidentified package',ingredients:[],additives:[],allergens:[],claims:[],nutrients:[],warnings:[],rawText:'',synthetic:true,createdAt:'2026-10-26T00:00:00Z',observations:[{id:'ocr',field:'raw-text',text:'Synthetic quantity input',side:'text',origin:'fixture',confidence:null}]})});

it('rejects an invalid quantity declaration while retaining independent supported rows unchanged',()=>{
 const raw={...content,quantityDeclarations:[{kind:'servings-per-package',printedText:'unreadable',quantity:1,unit:'g',status:'provisional',evidence}]},before=structuredClone(raw);
 const result=validateReconstructionSections(raw);expect(raw).toEqual(before);expect(result.parsed.success).toBe(true);expect(result.rejected).toMatchObject([{section:'quantityDeclarations',index:0,issues:[{path:'unit',code:'custom'}]}]);
 if(!result.parsed.success)throw result.parsed.error;
 expect(result.parsed.data.quantityDeclarations).toEqual([]);expect(result.parsed.data.nutritionRows).toEqual([row]);expect(sanitizePackageReconstruction(result.parsed.data,input)?.content.nutritionRows).toEqual([row]);
});
it('separates malformed nutrition/ingredient/statement entries without a semantic repair or guessed value',()=>{
 const ingredient={position:1,name:'Wheat',printedText:'Wheat',printedPercentage:null,normalizedName:null,status:'provisional',evidence};
 const raw={...content,nutritionRows:[row,{...row,rowId:'bad',value:-1}],ingredients:[ingredient,{...ingredient,position:2,printedPercentage:120}],statements:[{kind:'unsupported-kind',label:null,text:'invalid',status:'clear',evidence}]};
 const result=validateReconstructionSections(raw);expect(result.parsed.success).toBe(true);if(!result.parsed.success)throw result.parsed.error;
 expect(result.parsed.data.nutritionRows).toEqual([row]);expect(result.parsed.data.ingredients).toEqual([ingredient]);expect(result.parsed.data.statements).toEqual([]);expect(result.rejected.map(r=>r.section)).toEqual(['nutritionRows','ingredients','statements']);
});
it('normalizes provider null sentinels only in nullable text fields while preserving numeric readings',()=>{
 const raw={...content,nutritionRows:[{...row,qualifier:'null',columnLabel:' undefined ',basisText:'null'}]};
 const result=validateReconstructionSections(raw);expect(result.rejected).toEqual([]);if(!result.parsed.success)throw result.parsed.error;
 expect(result.parsed.data.nutritionRows[0]).toMatchObject({value:8.8,unit:'g',qualifier:null,columnLabel:null,basisText:null});
 expect(raw.nutritionRows[0]).toMatchObject({qualifier:'null',columnLabel:' undefined ',basisText:'null'});
});
it('does not bypass collection bounds or invent required singleton fields',()=>{
 const result=validateReconstructionSections({...content,nutritionRows:Array.from({length:101},()=>row)});expect(result.parsed.success).toBe(true);if(!result.parsed.success)throw result.parsed.error;expect(result.parsed.data.nutritionRows).toEqual([]);expect(result.rejected[0]).toMatchObject({section:'nutritionRows',index:null});
 expect(validateReconstructionSections({...content,identity:{...content.identity,name:123}}).parsed.success).toBe(false);expect(validateReconstructionSections(null).parsed.success).toBe(false);
});
it('still withholds unsupported evidence after sectional shape validation',()=>{
 const parsed=validateReconstructionSections({...content,nutritionRows:[{...row,evidence:{observationIds:['not-supplied'],imageRegions:[]}}]});expect(parsed.parsed.success).toBe(true);if(!parsed.parsed.success)throw parsed.parsed.error;expect(sanitizePackageReconstruction(parsed.parsed.data,input)).toBeNull();
});
