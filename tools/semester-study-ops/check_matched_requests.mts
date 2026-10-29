/** Offline integrity checks over the actual frozen requests, never answer-quality judgments. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {packageSchema} from '../../src/lib/contracts';
const base=path.resolve(process.argv[2]??'.data/matched-conversation-benchmark-20261029-v1/run-v3');
const load=async(p:string)=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const hash=(x:unknown)=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const freeze=await load(path.join(base,'freeze.json'));
assert.equal(freeze.order.length,51);
assert.equal(new Set(freeze.order).size,51);
assert.equal(freeze.originalTurns,27);assert.equal(freeze.transferTurns,24);
const checked=[];
for(const id of freeze.order){
 const c=await load(path.join(base,'cases',id+'.json'));
 packageSchema.parse(c.package);
 assert.equal(hash(c.package),c.packageSha256,`${id}: package changed`);
 assert.equal(hash(c.question),c.questionSha256,`${id}: question changed`);
 for(const mode of ['synthesis','native']){
  const r=c.requests[mode];
  assert.equal(hash(r.logical),r.sha256,`${id}/${mode}: request changed`);
  const frozen=freeze.cases.find((f:any)=>f.id===id);
  assert.equal(r.sha256,frozen.requests[mode]);
  assert.equal(r.logical.system.startsWith(freeze.systems[mode]),true);
  assert.equal(typeof r.logical.user,'string');
  assert.doesNotMatch(r.logical.user,/data:image\//i,'Conversation input must contain no image bytes');
  const payload=JSON.parse(r.logical.user);
  assert.ok(payload);
  assert.equal(r.logical.tools.length,mode==='synthesis'?0:12);
 }
 if(['A-H','B-H'].includes(c.conversationId)){
  assert.equal(c.package.nutrients.some((n:any)=>n.key==='sodium'),false);
  for(const row of c.package.reconstruction?.nutritionRows??[]){
   if(row.nutrientKey==='sodium'||row.nutrient.toLowerCase()==='sodium'){
    assert.equal(row.value,null);assert.equal(row.status,'unreadable');
   }
  }
  assert.ok(c.history.every((h:any)=>h.answer.includes('withheld')));
 }
 if(c.id==='correction-after-calculation-2')assert.ok(c.package.nutrients.some((n:any)=>n.key==='carbohydrate'&&n.status==='corrected'&&n.value===60));
 checked.push(id);
}
// Compare actual first requests and immutable canonical hashes for any completed batches.
let receipts=0;
for(const dir of await readdir(path.join(base,'runs')).catch(()=>[])){
 for(const name of await readdir(path.join(base,'runs',dir))){
  if(!freeze.order.some((id:string)=>name===id+'.json'))continue;
  const r=await load(path.join(base,'runs',dir,name));
  const c=await load(path.join(base,'cases',r.caseId+'.json'));
  const mode=r.condition==='synthesis'?'synthesis':'native';
  assert.equal(r.canonicalRequestSha256,c.requests[mode].sha256);
  const request=r.generations[0]?.request;
  if(request){
   const user=request.messages?.[1]?.content??request.contents?.[0]?.parts?.[0]?.text;
   const system=request.messages?.[0]?.content??request.config?.systemInstruction;
   assert.equal(user,c.requests[mode].logical.user,`${dir}/${name}: user serialization mismatch`);
   assert.equal(system,c.requests[mode].logical.system,`${dir}/${name}: system serialization mismatch`);
  }
  receipts++;
 }
}
console.log(JSON.stringify({status:'PASS',cases:checked.length,receiptRequestsChecked:receipts,scope:'Input integrity and serialization only; no scientific correctness or browser acceptance claim'}));
