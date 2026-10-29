/** Receipt-derived analysis; no model calls or invented reviewer judgments. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {normalizeLocalAnswer} from './conversation-evaluation-views.mts';
import {conversationAnswerBlocks} from '../../src/lib/conversation-answer';
const root=path.resolve('.data/matched-conversation-benchmark-20261029-v1');
const out=path.resolve(process.argv[2]??path.join(root,'analysis-'+Date.now()));
const load=async(p:string)=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const freeze=await load(path.join(root,'run-v3/freeze.json'));
const usage=await load(path.resolve('.data/gemini-usage.json'));
const diagnosticLines=(await readFile(path.resolve('.data/gemini-diagnostics.jsonl'),'utf8')).split('\n').filter(Boolean).flatMap(s=>{try{return[JSON.parse(s)];}catch{return[];}});
await mkdir(out,{recursive:false});await mkdir(path.join(out,'display-reconciliation'));
const samples=(await readFile(path.join(root,'resources.jsonl'),'utf8')).split('\n').filter(Boolean).flatMap(s=>{try{return[JSON.parse(s)];}catch{return[];}});
const rows:any[]=[];const excluded:any[]=[];
const pct=(xs:number[],p:number)=>{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y);const i=(a.length-1)*p;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1);};
for(const version of ['run-v2','run-v3'])for(const dir of await readdir(path.join(root,version,'runs')).catch(()=>[])){
 if(!dir.includes('-primary-')&&!dir.includes('-repeat-'))continue;
 for(const name of await readdir(path.join(root,version,'runs',dir))){
  if(!freeze.order.some((id:string)=>name===id+'.json'))continue;
  const file=path.join(root,version,'runs',dir,name),r=await load(file);
  const c=await load(path.join(root,'run-v3/cases',name));const mode=r.condition==='synthesis'?'synthesis':'native';
  if(r.canonicalRequestSha256!==c.requests[mode].sha256){excluded.push({file,reason:'Different canonical request'});continue;}
  const normalized=normalizeLocalAnswer(r.rawAnswer,{pkg:c.package,question:c.question,history:c.history,profile:c.profile,calculations:r.effectiveCalculations,evidence:r.effectiveEvidence,aliases:new Map(r.aliases),currentEvidenceIds:new Set(r.effectiveEvidence.map((s:any)=>s.id))});
  const derivative={receiptRelativePath:path.relative(root,file),receiptSha256:sha(await readFile(file)),helperSha256:sha(await readFile(new URL('./conversation-evaluation-views.mts',import.meta.url))),rawAnswerUnchanged:true,validatedText:normalized.renderedAnswer,displayBlocks:conversationAnswerBlocks(normalized.renderedAnswer),validation:normalized.validation,withheldSpans:normalized.withheldSpans,sourceScope:normalized.sourceScope,citedSourceIds:normalized.citedSourceIds,browserObserved:false,scope:'Offline application text validation reconciliation; original receipt remains immutable, no new inference'};
  await writeFile(path.join(out,'display-reconciliation',version+'-'+dir+'-'+name),JSON.stringify(derivative,null,2)+'\n',{flag:'wx'});
  const resources=samples.filter(s=>s.at>=r.startedAt&&s.at<=r.endedAt);
  const generations=r.generations??[];
  const sumKnown=(key:string)=>generations.length&&generations.every((g:any)=>typeof g[key]==='number')?generations.reduce((s:number,g:any)=>s+g[key],0):null;
  const analysisId='matched-'+dir+'-'+r.caseId;
  const callIds=new Set(diagnosticLines.filter(d=>d.analysisId===analysisId&&d.callId).map(d=>d.callId));
  const ledger=usage.calls.filter((x:any)=>callIds.has(x.id));
  const paidKnown=ledger.length&&ledger.every((x:any)=>typeof x.estimatedActualUsd==='number');
  const expected=r.expectedOperations??[];
  const exactOperations=expected.filter((op:any)=>r.toolTrace.some((t:any)=>t.name==='calculate_nutrition'&&Object.entries(op).every(([k,v])=>t.args[k]===v)));
  rows.push({model:r.model,condition:r.condition,phase:r.phase,repeat:r.repeat,caseId:r.caseId,suite:r.suite,status:r.status,actualModels:[...new Set(generations.map((g:any)=>g.actualModel).filter(Boolean))].join('|'),seconds:r.elapsedMs/1000,generations:generations.length,tools:r.toolTrace.length,toolErrors:r.toolTrace.filter((t:any)=>t.status!=='ok'&&t.status!=='success').map((t:any)=>({name:t.name,status:t.status})),expectedOperations:expected.length,exactArgumentOperations:exactOperations.length,operationMetricLimitation:'Exact argument coverage only; alternative physically equivalent valid plans require review',rawCharacters:r.rawAnswer.length,displayedCharacters:normalized.renderedAnswer.length,withheldNumericalSpans:normalized.withheldSpans.length,sourceScopeWithheld:normalized.sourceScope.withheldSentenceCount,citedSources:normalized.citedSourceIds.length,returnedSources:r.effectiveEvidence.length,inputTokens:sumKnown('inputTokens'),outputTokens:sumKnown('outputTokens'),thinkingTokens:sumKnown('thoughtTokens'),cachedTokens:sumKnown('cachedTokens'),firstVisibleTextSeconds:typeof generations[0]?.ttftMs==='number'?generations[0].ttftMs/1000:null,promptSeconds:typeof generations[0]?.promptNs==='number'?generations[0].promptNs/1e9:null,generationSeconds:typeof generations[0]?.generationNs==='number'?generations[0].generationNs/1e9:null,outputTokensPerSecond:generations[0]?.generationNs>0?generations[0].outputTokens/(generations[0].generationNs/1e9):null,estimatedUsd:r.tier==='local'||r.tier==='free'?0:paidKnown?ledger.reduce((s:number,x:any)=>s+x.estimatedActualUsd,0):null,billedUsd:r.tier==='local'?0:null,minAvailableMB:resources.length?Math.min(...resources.map(s=>s.availableMB).filter(Number.isFinite)):null,maxCommittedBytes:resources.length?Math.max(...resources.map(s=>s.committedBytes).filter(Number.isFinite)):null,maxPagefileMB:resources.length?Math.max(...resources.map(s=>s.pagefileMB).filter(Number.isFinite)):null,p95PageReads:pct(resources.map(s=>s.pageReadsPerSec).filter(Number.isFinite),.95),p95MachineCPU:pct(resources.map(s=>s.machineCPUPercent).filter(Number.isFinite),.95),resourceSamples:resources.length,networkHosts:[...new Set(r.networkEvents.map((n:any)=>n.host))].join('|'),referenceGrade:3,independentHumanRating:null,scientificEntailmentScore:null,receipt:path.relative(root,file),receiptSha256:derivative.receiptSha256});
 }
}
const groups:any[]=[];
for(const key of [...new Set(rows.map(r=>[r.model,r.condition,r.phase].join('/'))) ]){
 const rs=rows.filter(r=>[r.model,r.condition,r.phase].join('/')===key);
 groups.push({group:key,attempted:rs.length,completed:rs.filter(r=>r.status==='completed').length,uniqueCases:new Set(rs.map(r=>r.caseId)).size,p50Seconds:pct(rs.map(r=>r.seconds),.5),p90Seconds:pct(rs.map(r=>r.seconds),.9),p95Seconds:pct(rs.map(r=>r.seconds),.95),meanSeconds:rs.reduce((s,r)=>s+r.seconds,0)/rs.length,estimatedUsd:rs.every(r=>r.estimatedUsd!==null)?rs.reduce((s,r)=>s+r.estimatedUsd,0):null,correctAnswerCount:null,timePerCorrectAnswer:null,limitation:'Completion and mechanical evidence metrics are not answer correctness or a model ranking'});
}
const csv=(items:any[])=>{const keys=Object.keys(items[0]??{});const cell=(v:any)=>JSON.stringify(typeof v==='object'&&v!==null?JSON.stringify(v):v??'');return[keys.join(','),...items.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n';};
await writeFile(path.join(out,'per-case.json'),JSON.stringify(rows,null,2)+'\n');
await writeFile(path.join(out,'per-case.csv'),csv(rows));await writeFile(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),freezeSha256:sha(await readFile(path.join(root,'run-v3/freeze.json'))),rows:rows.length,groups,excluded,limitations:['Grade 3 snapshots','Shared teacher-forced history, not own-answer rollout','No independent human scores','No scientific entailment score inferred from citation count','Display reconciliation is offline, not browser acceptance','Percentiles include failures; zero samples remain unknown']},null,2)+'\n');
console.log(JSON.stringify({out,rows:rows.length,groups}));
