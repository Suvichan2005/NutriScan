/** Script-level integration check; synthetic DOM, not real-browser acceptance. */
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
async function run(){
 const html=fs.readFileSync(process.argv[2],'utf8');
 const matches=[...html.matchAll(/<script(?: type="application\/json" id="data")?>([\s\S]*?)<\/script>/g)];
 assert.equal(matches.length,2);
 const payload=JSON.parse(matches[0][1]);
 const elements=new Map();const downloads=[];const blobs=new Map();const storage=new Map();let writes=0;
 function element(id=''){return {id,value:'',checked:false,textContent:'',className:'',disabled:false,children:[],append(x){this.children.push(x)},setAttribute(){},click(){downloads.push(this.href)}};}
 const doc={getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id)},createElement(){return element()},addEventListener(name,fn){this[name]=fn}};
 doc.getElementById('data').textContent=matches[0][1];
 const context={document:doc,console,Blob,URL:{createObjectURL(blob){const id='blob:'+blobs.size;blobs.set(id,blob);return id},revokeObjectURL(){}},setTimeout(){},localStorage:{setItem(k,v){writes++;storage.set(k,v)},getItem(k){return storage.get(k)||null},removeItem(k){storage.delete(k)}}};
 vm.createContext(context);vm.runInContext(matches[1][1],context);
 const el=id=>doc.getElementById(id);
 assert.equal(el('answer').textContent,payload.packets[0].displayedResponse);
 assert.equal(writes,0,'No default local-storage writes');
 el('export').onclick();assert.equal(downloads.length,0,'Pending ratings cannot export');
 el('reviewer').value='SYNTHETIC-SCRIPT-REVIEWER';el('human').checked=true;el('evidence').value='synthetic fixture\nsecond evidence pointer';
 for(const d of payload.dimensions)el('score-'+d).value='3';
 const dim=payload.dimensions[0];el('score-'+dim).value='NA';el('export').onclick();assert.equal(downloads.length,0,'N/A requires reason');
 el('reason-'+dim).value='Synthetic structural N/A example';el('critical').value='not json';el('export').onclick();assert.equal(downloads.length,0,'Invalid critical-error JSON rejected');
 el('critical').value='[]';el('persist').checked=true;doc.input({target:el('evidence')});assert.equal(writes,1);
 el('next').onclick();assert.equal(el('answer').textContent,payload.packets[1].displayedResponse);el('previous').onclick();assert.equal(el('reason-'+dim).value,'Synthetic structural N/A example');
 el('export').onclick();assert.equal(downloads.length,1);
 const exported=JSON.parse(await blobs.get(downloads[0]).text());assert.equal(exported.length,1);assert.equal(exported[0].raterCode,'SYNTHETIC-SCRIPT-REVIEWER');assert.equal(exported[0].scores[dim],null);assert.equal(exported[0].evidencePointers.length,2);assert.equal(Object.keys(exported[0]).some(k=>k.startsWith('_')),false);
 el('clear').onclick();assert.equal(storage.size,0);assert.equal(el('persist').checked,false);
 const output=process.argv[3];if(output){if(!path.resolve(output).split(path.sep).includes('.data'))throw Error('Private fixture output must remain under .data');fs.writeFileSync(output,JSON.stringify(exported,null,2)+'\n',{flag:'wx'});}
 console.log(JSON.stringify({status:'PASS',scope:'synthetic-DOM-script-check-not-browser-acceptance',responses:payload.packets.length,exportedSyntheticRows:exported.length,defaultStorageWrites:0,navigation:'PASS',naAndCriticalErrors:'PASS',downloadBlob:'PASS',optionalDraftPersistence:'PASS'}));
}
run().catch(e=>{console.error(e);process.exitCode=1});
