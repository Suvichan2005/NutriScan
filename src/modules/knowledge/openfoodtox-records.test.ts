import {afterEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readOpenFoodToxRecords} from './openfoodtox-records';

let directory:string|undefined;
afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true});directory=undefined;});
const subject='11111111-1111-4111-8111-111111111111';
async function fixture(){
 directory=await mkdtemp(path.join(tmpdir(),'nutriscan-oft-'));
 const file=path.join(directory,'source.sqlite'),db=new DatabaseSync(file);
 try{
  db.exec('CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE sheets(name TEXT,headers_json TEXT);CREATE TABLE records(sheet TEXT,source_row INTEGER,document_id TEXT,parent_id TEXT,endpoint TEXT,cells_json TEXT);CREATE TABLE links(sheet TEXT,source_row INTEGER,field TEXT,target_id TEXT,target_type TEXT);');
  db.prepare('INSERT INTO metadata VALUES(?,?)').run('manifest',JSON.stringify({schemaVersion:1,sourceSha256:'5181661e921651d4087b544981e1e5a63b99532844eac0112732806a00a85eda'}));
  db.prepare('INSERT INTO metadata VALUES(?,?)').run('source',JSON.stringify({releaseDate:'2026-04-30',license:'CC BY-ND 4.0'}));
  for(const sheet of ['SUB','END_STUDY_REC.HumanHealth','LIT'])db.prepare('INSERT INTO sheets VALUES(?,?)').run(sheet,JSON.stringify([null,'Document UUID','Parent UUID','Endpoint','Dose.Unit','Dose.Value','Population','Discussion']));
  const insert=db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');
  insert.run('SUB',2,subject,null,null,'[[3,"Fictional compound"]]');
  insert.run('END_STUDY_REC.HumanHealth',2,'study-one',subject,'test endpoint',JSON.stringify([[3,'test endpoint'],[4,'mg/kg bw/day'],[5,2],[6,'test animals'],[7,'x'.repeat(4500)]]));
  insert.run('END_STUDY_REC.HumanHealth',3,'study-one',subject,'test endpoint','[[5,3]]');
  insert.run('LIT',2,'citation',null,null,'[[7,"Developer-authored citation fixture"]]');
  insert.run('LIT',3,'unrelated',null,null,'[[7,"Unrelated fixture"]]');
  db.prepare('INSERT INTO links VALUES(?,?,?,?,?)').run('END_STUDY_REC.HumanHealth',2,'DataSource.Reference','citation','LITERATURE');
 }finally{db.close();}
 return file;
}
it('distinguishes flattened rows from documents and retains endpoint context, units and references',async()=>{
 const file=await fixture();
 const overview=await readOpenFoodToxRecords({substanceId:subject},file);
 expect(overview).toMatchObject({status:'ok',coverage:[{sheet:'END_STUDY_REC.HumanHealth',rows:2,documents:1}],relatedRecords:[{recordId:'LIT:2',kind:'scientific-publication'}]});
 const page=await readOpenFoodToxRecords({substanceId:subject,section:'human-health',limit:1},file);
 expect(page).toMatchObject({status:'ok',totalRows:2,nextOffset:1,results:[{recordId:'END_STUDY_REC.HumanHealth:2',otherRowsForDocument:1,fields:{'Dose.Unit':'mg/kg bw/day','Dose.Value':2,Population:'test animals'},truncatedFields:['Discussion'],links:[{targetId:'citation',records:['LIT:2']}]}]});
 expect(page.results[0].fields.Discussion).toBeUndefined();
 expect(page.results[0].selectedFieldsComplete).toBe(false);
 expect(await readOpenFoodToxRecords({substanceId:subject,recordId:'LIT:2'},file)).toMatchObject({status:'ok',results:[{fields:{Discussion:'Developer-authored citation fixture'}}]});
 expect(await readOpenFoodToxRecords({substanceId:subject,recordId:'LIT:3'},file)).toMatchObject({status:'no_match',results:[]});
 const detailed=await readOpenFoodToxRecords({substanceId:subject,recordId:'END_STUDY_REC.HumanHealth:2',fields:['Discussion']},file);
 expect(detailed.results[0].fields.Discussion).toHaveLength(4500);
 expect(detailed.results[0].truncatedFields).toEqual([]);
 expect(detailed.results[0].selectedFieldsComplete).toBe(true);
 const missing=await readOpenFoodToxRecords({substanceId:subject,recordId:'END_STUDY_REC.HumanHealth:2',fields:['not-a-source-field']},file);
 expect(missing.results[0]).toMatchObject({missingFields:['not-a-source-field'],selectedFieldsComplete:false});
});
it('distinguishes absent source/identity/section and rejects invalid arguments',async()=>{
 const file=await fixture();
 expect(await readOpenFoodToxRecords({substanceId:subject,section:'reference-values'},file)).toMatchObject({status:'no_match',totalRows:0});
 expect(await readOpenFoodToxRecords({substanceId:'22222222-2222-4222-8222-222222222222'},file)).toMatchObject({status:'no_match'});
 expect(await readOpenFoodToxRecords({substanceId:subject},file+'-absent')).toMatchObject({status:'unavailable',reason:'not-imported'});
 await expect(readOpenFoodToxRecords({substanceId:subject,limit:6},file)).rejects.toThrow();
 await expect(readOpenFoodToxRecords({substanceId:subject,fields:['Discussion']},file)).rejects.toThrow();
});
