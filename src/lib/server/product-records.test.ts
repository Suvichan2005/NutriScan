import {expect,it,vi,afterEach} from 'vitest';
import {readProductRecord,selectProductRecord} from './product-records';
import {executeGeminiTool,type GeminiToolContext} from './gemini-tools';
import {parseLabel} from '../parser';

const code='8901058022193';
const source={status:1,product:{code,product_name:'Developer fixture, not real product data',rev:2,nutrition_data_per:'serving',nutrition_data_prepared_per:'100g',serving_size:'30 g',serving_quantity:30,serving_quantity_unit:'g',nutriments:{sugars_100g:0,sugars_unit:'g',proteins_prepared_100g:5,proteins_prepared_serving:1.5},ingredients_text:'Example',ingredients:[{id:'en:wheat',text:'Wheat',percent:90,ingredients:[{text:'nested source ingredient'}]}],allergens_tags:['en:gluten'],traces_tags:['en:milk']}};
afterEach(()=>vi.unstubAllGlobals());
it('preserves raw nutrient basis, prepared values, zero and unavailable fields without converting them',()=>{
 expect(selectProductRecord(source,{barcode:code,section:'nutrition'})).toMatchObject({status:'ok',sourceRevision:2,context:{nutrition_data_per:'serving',nutrition_data_prepared_per:'100g',serving_quantity:30},missingFields:['nutrition_data','no_nutrition_data']});
 expect(selectProductRecord(source,{barcode:code,section:'nutrition',field:'nutriments',entryKey:'sugars_100g'})).toMatchObject({status:'ok',total:1,results:[{key:'sugars_100g',value:0}]});
 expect(selectProductRecord(source,{barcode:code,section:'nutrition',field:'nutriments',entryKey:'absent'})).toMatchObject({status:'ok',total:0,results:[]});
 expect(selectProductRecord(source,{barcode:code,section:'nutrition',field:'nutriments',limit:1})).toMatchObject({total:4,nextOffset:1});
 expect(selectProductRecord(source,{barcode:code,section:'nutrition',field:'nutrition_data'})).toMatchObject({status:'no_field'});
 expect(selectProductRecord(source,{barcode:code,section:'nutrition',field:'api_key'})).toMatchObject({status:'invalid_field'});
 expect(selectProductRecord(source,{barcode:'0000000000000'})).toMatchObject({status:'identity_mismatch'});
 expect(selectProductRecord({status:0},{barcode:code})).toMatchObject({status:'no_match'});
});

it('keeps complete ingredient hierarchy and allergen/precaution relationships distinct',()=>{
 const detail=selectProductRecord(source,{barcode:code,section:'ingredients',field:'ingredients'});
 expect(detail).toMatchObject({results:[{percent:90,ingredients:[{text:'nested source ingredient'}]}]});
 expect(selectProductRecord(source,{barcode:code,section:'ingredients',field:'allergens_tags'})).toMatchObject({results:['en:gluten']});
 expect(selectProductRecord(source,{barcode:code,section:'ingredients',field:'traces_tags'})).toMatchObject({results:['en:milk']});
 expect(selectProductRecord({...source,product:{...source.product,ingredients_text:'x'.repeat(13000)}},{barcode:code,section:'ingredients',field:'ingredients_text'})).toMatchObject({status:'item_too_large',results:[]});
});

it('restricts native detail inspection to an actual eligible barcode and returns attributed source data',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(source),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 const context:GeminiToolContext={question:`Please inspect ${code}`,package:parseLabel('Developer test'),visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
 const result=await executeGeminiTool('get_product_record',{barcode:code,section:'nutrition',field:'nutriments'},context);
 expect(result).toMatchObject({status:'ok',resultCount:1,output:{sourceRevision:2},evidence:[{publisher:'Open Food Facts',category:'product'}]});
 expect(String(fetch.mock.calls[0][0])).toContain('/api/v3/product/8901058022193.json');
 fetch.mockClear();expect(await executeGeminiTool('get_product_record',{barcode:code},{...context,question:'Unrelated question'})).toMatchObject({status:'withheld'});expect(fetch).not.toHaveBeenCalled();
 expect(await readProductRecord({barcode:code,section:'identity',field:'nutriments'})).toMatchObject({status:'invalid_field'});expect(fetch).not.toHaveBeenCalled();
});

it('distinguishes documented missing-product responses from transport errors',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 fetch.mockResolvedValueOnce(new Response(JSON.stringify({code,result:{id:'product_not_found'},status:'failure'}),{status:404,headers:{'content-type':'application/json'}}));
 expect(await readProductRecord({barcode:code})).toMatchObject({status:'no_match'});
 fetch.mockResolvedValueOnce(new Response('<html>not found</html>',{status:404,headers:{'content-type':'text/html'}}));
 expect(await readProductRecord({barcode:code})).toMatchObject({status:'unavailable'});
 fetch.mockResolvedValueOnce(new Response(JSON.stringify({code,result:{id:'product_not_found'},status:'failure'}),{status:503,headers:{'content-type':'application/json'}}));
 expect(await readProductRecord({barcode:code})).toMatchObject({status:'unavailable'});
});

it('bounds object-key indexes without losing complete field-page access',()=>{
 const nutriments=Object.fromEntries(Array.from({length:240},(_,i)=>['source_key_'+i,i]));
 const result=selectProductRecord({...source,product:{...source.product,nutriments}},{barcode:code,section:'nutrition',field:'nutriments'});
 expect(result).toMatchObject({status:'ok',entryKeyCount:240,entryKeyIndexIncomplete:true,total:240,nextOffset:6});
 expect('availableEntryKeys'in result&&result.availableEntryKeys).toHaveLength(200);
 expect(selectProductRecord(source,{barcode:code,section:'nutrition',field:'serving_size',entryKey:'x'})).toMatchObject({status:'invalid_entry_selection'});
 expect(()=>selectProductRecord(source,{barcode:code,entryKey:'x'})).toThrow();
});
