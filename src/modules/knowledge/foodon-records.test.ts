import {it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {readFoodOnSourceRecord} from './foodon-records';
import {executeGeminiTool,type GeminiToolContext} from '../../lib/server/gemini-tools';
import {parseLabel} from '../../lib/parser';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const pin='b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf';
it('preserves source fields, pagination, status, corruption and native source linkage',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nutriscan-foodon-records-')),file=path.join(directory,'records.sqlite');
 const db=new DatabaseSync(file);db.exec('CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE concepts(id TEXT,label TEXT,deprecated INTEGER,xml TEXT,xml_hash TEXT);CREATE TABLE fields(concept_id TEXT,ordinal INTEGER,kind TEXT,predicate TEXT,payload TEXT,payload_hash TEXT);');
 for(const [key,value]of Object.entries({schemaVersion:'1',sourceHash:pin,counts:JSON.stringify({classes:2,fields:2})}))db.prepare('INSERT INTO metadata VALUES(?,?)').run(key,value);
 const id='FOODON_03310075',xml='<developer-fixture/>';
 db.prepare('INSERT INTO concepts VALUES(?,?,?,?,?)').run(id,'Developer source term',null,xml,hash(xml));
 db.prepare('INSERT INTO concepts VALUES(?,?,?,?,?)').run('FOODON_00000002','Deprecated fixture',1,xml,hash(xml));
 for(let i=0;i<2;i++){const value=JSON.stringify({predicate:'{http://purl.obolibrary.org/obo/}IAO_0000115',attributes:{'{http://www.w3.org/XML/1998/namespace}lang':'en'},text:`Developer source definition ${i}.`,tail:null,children:[]});db.prepare('INSERT INTO fields VALUES(?,?,?,?,?,?)').run(id,i,'class','definition',value,hash(value));}db.close();
 vi.stubEnv('NUTRISCAN_FOODON_RECORDS_DATABASE',file);
 try{
  const source={ontologySha256:pin};expect(readFoodOnSourceRecord({id,offset:0,limit:1},source)).toMatchObject({sourcePresence:'owl-class-declaration',deprecated:null,total:2,nextOffset:1,results:[{ordinal:0,value:{text:'Developer source definition 0.'}}]});
  expect(readFoodOnSourceRecord({id,offset:1,limit:1},source)).toMatchObject({nextOffset:null,results:[{ordinal:1}]});
  expect(readFoodOnSourceRecord({id:'FOODON_00000002',offset:0,limit:2},source)).toMatchObject({deprecated:true,sourcePresence:'owl-class-declaration'});
  expect(readFoodOnSourceRecord({id:'FOODON_03412317',offset:0,limit:2},source,{id:'FOODON_03412317',label:'Export-only fixture'})).toMatchObject({sourcePresence:'synonym-export-only',deprecated:null,results:[]});
  expect(readFoodOnSourceRecord({id:'FOODON_99999999',offset:0,limit:2},source)).toMatchObject({status:'no_match'});
  const context:GeminiToolContext={question:'Developer source inspection',package:parseLabel('Developer'),visualImages:[],searchTerms:new Set(),prepareImage:async image=>image.base64};
  const native=await executeGeminiTool('get_ingredient_concept',{id,relation:'source',limit:1},context);expect(native).toMatchObject({status:'ok',output:{sourceFields:[{ordinal:0}]}});expect(native.evidence?.some(e=>e.summary.includes('Developer source definition 0.'))).toBe(true);
  const edit=new DatabaseSync(file);edit.prepare('UPDATE fields SET payload=? WHERE ordinal=0').run('{}');edit.close();expect(readFoodOnSourceRecord({id,offset:0,limit:2},source)).toMatchObject({corruptFields:[0],results:[{ordinal:1}]});
  const incomplete=new DatabaseSync(file);incomplete.exec('DELETE FROM fields WHERE ordinal=0');incomplete.close();expect(readFoodOnSourceRecord({id,offset:0,limit:2},source)).toMatchObject({status:'unavailable'});
 }finally{vi.unstubAllEnvs();await rm(file);await rmdir(directory);}
});
