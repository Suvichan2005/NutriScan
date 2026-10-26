/** Explicit local provider adapter. Reads raw evidence only, never reference labels. */
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {analysisMethodSchema} from '../../src/lib/contracts';
import {analysisMethodPolicy} from '../../src/lib/analysis-method';
import {reconstructPackageForEvaluation} from '../../src/lib/server/gemini';
import {geminiEvaluationCaptureEnabled} from '../../src/lib/server/gemini-evaluation-recorder';

try {
 if(process.argv.slice(2).join(' ')!=='--allow-provider')throw new Error('explicit-provider-action-required');
 process.env.NODE_ENV??='development';
 const require=createRequire(import.meta.url);
 const {loadEnvConfig}=require('@next/env') as typeof import('@next/env');
 loadEnvConfig(process.cwd(),true,{info(){},error(){}});
 if(!geminiEvaluationCaptureEnabled())throw new Error('local-readable-capture-required');
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
 const result=await reconstructPackageForEvaluation({...raw,analysisMethod:method,...(!policy.images?{visualImages:undefined}:{})});
 const events=(await readFile(path.join('.data/gemini-evaluations',result.diagnosticId,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const routes=events.filter(event=>event.event==='provider_route');
 const ledger=JSON.parse(await readFile('.data/gemini-usage.json','utf8'));
 const metadata=events.filter(event=>['provider_response','provider_error'].includes(event.event)).map(({event,callId,model,response,failure})=>({event,callId,model,usage:response?.usageMetadata??null,cost:response?.costEstimate??null,elapsedMs:ledger.calls.find((call:{id:string})=>call.id===callId)?.elapsedMs??null,failure:failure??null}));
 process.stdout.write(JSON.stringify({...result,providerRoutes:routes,providerCallMetadata:metadata,claimScope:'unscored-controlled-extraction'})+'\n');
}catch(error){
 // Never copy provider bodies, credentials, input data or stacks to the runner.
 const code=error&&typeof error==='object'&&'code'in error?String(error.code):error instanceof Error?error.message:'adapter-failed';
 process.stderr.write(JSON.stringify({status:'failed',code:/^[a-z0-9_-]{1,100}$/i.test(code)?code:'invalid-input-or-provider-failure'})+'\n');process.exitCode=1;
}
