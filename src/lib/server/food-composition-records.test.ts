import {afterEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readFoodCompositionSource} from './food-composition-records';
import {existsSync} from 'node:fs';
import {searchFoodComposition} from './food-composition';

let directory:string|undefined;
afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
it('preserves complete nutrient objects, unavailable amounts, source recipes and bounded pages',async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'nutriscan-fdc-source-'));const file=path.join(directory,'fixture.sqlite');
 const db=new DatabaseSync(file);
 try{
  db.exec('CREATE TABLE sources(id TEXT,metadata TEXT);CREATE TABLE records(release TEXT,fdc_id INTEGER,record_json TEXT);');
  db.prepare('INSERT INTO sources VALUES(?,?)').run('fdc-foundation-2026-04',JSON.stringify({sourceSha256:'27d1fe3fd89edfbe528ed915da5619320e1d004d4594603a1b19bdb1511590cc',completeObjectEqualityVerified:true}));
  db.prepare('INSERT INTO records VALUES(?,?,?)').run('fdc-foundation-2026-04',1,JSON.stringify({fdcId:1,description:'Developer fixture',oversized:'x'.repeat(24001),foodNutrients:[{amount:0,nutrient:{name:'Fictional nutrient'},foodNutrientDerivation:{code:'test',method:{note:'full provenance'}}},{nutrient:{name:'Unavailable amount'}}],inputFoods:[{recipe:{source:'developer',amount:null}}]}));
 }finally{db.close();}
 const base={release:'fdc-foundation-2026-04' as const,fdcId:1};
 expect(await readFoodCompositionSource(base,file)).toMatchObject({status:'ok',availableFields:['fdcId','description','oversized','foodNutrients','inputFoods']});
 expect(await readFoodCompositionSource({...base,field:'foodNutrients',limit:1},file)).toMatchObject({status:'ok',total:2,nextOffset:1,results:[{amount:0,foodNutrientDerivation:{method:{note:'full provenance'}}}]});
 const second=await readFoodCompositionSource({...base,field:'foodNutrients',offset:1},file);
 expect(second).toMatchObject({status:'ok',nextOffset:null,results:[{nutrient:{name:'Unavailable amount'}}]});
 expect('results' in second?second.results?.[0]:undefined).not.toHaveProperty('amount');
 expect(await readFoodCompositionSource({...base,field:'inputFoods'},file)).toMatchObject({results:[{recipe:{amount:null}}]});
 expect(await readFoodCompositionSource({...base,field:'oversized'},file)).toMatchObject({status:'field_too_large',results:[]});
 expect(await readFoodCompositionSource({...base,fdcId:2},file)).toMatchObject({status:'no_match'});
 expect(await readFoodCompositionSource({...base,field:'foodNutrients',nutrientId:999},file)).toMatchObject({status:'ok',total:0,results:[]});
 expect(await readFoodCompositionSource({...base,field:'missing'},file)).toMatchObject({status:'no_field'});
 expect(await readFoodCompositionSource(base,file+'absent')).toMatchObject({status:'unavailable',reason:'not-imported'});
 await expect(readFoodCompositionSource({...base,limit:11},file)).rejects.toThrow();
});

it.skipIf(!existsSync('.data/food-composition/fdc-source-records.sqlite'))('transfers Foundation-specific retrieval into the exact pinned source detail without substituting FNDDS',async()=>{
 const found=await searchFoodComposition('chickpeas dry',3,'fdc-foundation-2026-04');
 if(found.status==='unavailable')throw new Error('Imported local source failed validation');
 expect(found.status).toBe('ok');
 expect(found.results?.every(row=>row.food.dataType==='Foundation')).toBe(true);
 const match=found.results?.find(row=>row.food.fdcId===2644282);
 expect(match).toBeDefined();
 const detail=await readFoodCompositionSource({release:'fdc-foundation-2026-04',fdcId:2644282,field:'foodNutrients',nutrientId:1003,limit:10});
 expect(detail.status).toBe('ok');
 expect('results' in detail&&detail.results?.some(item=>(item as {nutrient:{id:number}}).nutrient.id===1003)).toBe(true);
 expect(await searchFoodComposition('chickpeas dry',3,'not-an-imported-release')).toMatchObject({status:'no_match',results:[]});
});
