/** Explicit local provider adapter. Reads raw evidence only, never reference labels. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {analysisMethodSchema} from '../../src/lib/contracts';
import {analysisMethodPolicy} from '../../src/lib/analysis-method';
import {reconstructPackageForEvaluation} from '../../src/lib/server/gemini';
import {geminiEvaluationCaptureEnabled} from '../../src/lib/server/gemini-evaluation-recorder';
import {controlledReceipt} from './controlled-receipt';

const privateRecords:Array<{path:string;sha256:string}>=[];
let analysisId:string|undefined;
async function retainControlledResponse(record:Record<string,unknown>){
 const id=String(record.diagnosticId);
 if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('invalid-controlled-diagnostic-id');
 analysisId=id;
 // The metadata recorder has already created this private directory and ACL.
 const directory=path.join('.data/gemini-evaluations',id);
 const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
 if(manifest.analysisId!==id||manifest.captureMode!=='local-opt-in-metadata-only')throw new Error('private-study-directory-required');
 const file=path.join(directory,record.stage==='initial-reconstruction-failed'?'controlled-failure.json':'controlled-response.json');
 const text=JSON.stringify(record)+'\n';
 await writeFile(file,text,{flag:'wx',mode:0o600});
 privateRecords.push({path:file,sha256:createHash('sha256').update(text).digest('hex')});
}

try {
 if(process.argv.slice(2).join(' ')!=='--allow-provider')throw new Error('explicit-provider-action-required');
 process.env.NODE_ENV??='development';
 const require=createRequire(import.meta.url);
 const {loadEnvConfig}=require('@next/env') as typeof import('@next/env');
 loadEnvConfig(process.cwd(),true,{info(){},error(){}});
 if(!geminiEvaluationCaptureEnabled())throw new Error('local-metadata-capture-required');
 let stdin='';for await(const chunk of process.stdin){stdin+=chunk;if(Buffer.byteLength(stdin)>1_000_000)throw new Error('job-too-large');}
 const job=JSON.parse(stdin);
 if(job.family!=='semester-reconstruction')throw new Error('wrong-experiment-family');
 const method=analysisMethodSchema.parse(job.adapter?.inputSelection?.analysisMethod),policy=analysisMethodPolicy(method);
 const source=job.inputFiles?.filter((file:{role?:string})=>file.role==='reconstruction-input');
 if(source?.length!==1)throw new Error('one-hashed-raw-reconstruction-input-required');
 const file=path.resolve(source[0].path),relative=path.relative(process.cwd(),file);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('input-outside-workspace');
 const bytes=await readFile(file);
 if(bytes.byteLength>14_000_000||createHash('sha256').update(bytes).digest('hex')!==source[0].sha256)throw new Error('raw-input-changed-or-oversize');
 const raw=JSON.parse(bytes.toString('utf8'));
 const result=await reconstructPackageForEvaluation({...raw,analysisMethod:method,...(!policy.images?{visualImages:undefined}:{})},retainControlledResponse);
 const events=(await readFile(path.join('.data/gemini-evaluations',result.diagnosticId,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const ledger=JSON.parse(await readFile('.data/gemini-usage.json','utf8'));
 process.stdout.write(JSON.stringify({...controlledReceipt(result,raw.package,source[0].sha256,events,ledger),privateRecords})+'\n');
}catch(error){
 // Never copy provider bodies, credentials, input data or stacks to the runner.
 const code=error&&typeof error==='object'&&'code'in error?String(error.code):error instanceof Error?error.message:'adapter-failed';
 let events:Record<string,unknown>[]=[];
 if(analysisId)try{events=(await readFile(path.join('.data/gemini-evaluations',analysisId,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{}
 process.stdout.write(JSON.stringify({status:'failed',code:/^[a-z0-9_-]{1,100}$/i.test(code)?code:'invalid-input-or-provider-failure',diagnosticId:analysisId??null,privateRecords,providerMetadata:events})+'\n');process.exitCode=1;
}
