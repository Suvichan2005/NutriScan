"""Evaluation-only jobs, gates and receipt scoring. No implicit provider/network calls."""
import argparse
import hashlib
import json
import math
import subprocess
from datetime import datetime,timezone
from decimal import Decimal,InvalidOperation
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
USAGE_FIELDS=['promptTokens','outputTokens','thoughtTokens','totalTokens','cachedPromptTokens','providerMs','toolMs','estimatedUsd','billedUsd']
RUBRIC=['usefulness','grounding','applicability','numericalCorrectness','uncertainty','actionability']

def load(file):
 return json.loads(Path(file).read_text(encoding='utf-8-sig'))

def sha(file):
 return hashlib.sha256(Path(file).read_bytes()).hexdigest()

def write_new(file,value):
 file=Path(file);file.parent.mkdir(parents=True,exist_ok=True)
 with file.open('x',encoding='utf-8') as handle:json.dump(value,handle,ensure_ascii=False,indent=2);handle.write('\n')

def validate_cases(manifest):
 seen=set();splits={};failures=[]
 for case in manifest.get('cases',[]):
  ident=case['caseId'];group=case['productGroupId'];split=case['split']
  if ident in seen:failures.append('duplicate caseId: '+ident)
  seen.add(ident)
  if split not in ['development','calibration','held-out','prospective-held-out']:failures.append('invalid split: '+ident)
  if group in splits and splits[group]!=split:failures.append('product group crosses splits: '+group)
  splits[group]=split
  if case.get('developmentExposed') and split!='development':failures.append('exposed product outside development: '+group)
 return failures

def gates(manifest,config,final=False):
 failures=validate_cases(manifest)
 if not manifest.get('cases'):failures.append('no acquired evaluation cases')
 for item in config.get('frozenFiles',[]):
  file=ROOT/item['path']
  if not file.is_file() or sha(file)!=item['sha256']:failures.append('frozen file missing or changed: '+item['path'])
 if final:
  for required in ['implementationCommit','model','generationConfig','promptHash','sourceSnapshotHash','toolAccessHash','freezeId','family']:
   if not config.get(required):failures.append('missing final freeze: '+required)
  if config.get('family') in ['retrieval','answer'] and config.get('trackAReady') is not True:failures.append('BLOCKED ON A: required capabilities not frozen/verified')
  if not config.get('frozenFiles'):failures.append('no frozen implementation/prompt/source artifacts')
  else:
   for role,key in [('prompt','promptHash'),('tools','toolAccessHash'),('sources','sourceSnapshotHash')]:
    if not any(item.get('role')==role and item.get('sha256')==config.get(key) for item in config['frozenFiles']):failures.append('freeze hash not bound to a checked '+role+' artifact')
  actual_commit=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.strip()
  if config.get('implementationCommit')!=actual_commit:failures.append('implementation commit differs from current checkout')
  if manifest.get('splitLock')!='locked':failures.append('product-group splits not locked')
  review=manifest.get('splitReview',{})
  if not review.get('reviewerCode') or not review.get('artifactFile') or not (ROOT/review['artifactFile']).is_file() or sha(ROOT/review['artifactFile'])!=review.get('artifactSha256'):failures.append('split allocation review artifact absent or changed')
  for case in manifest.get('cases',[]):
   prefix=case['caseId']+': '
   if case['split']=='prospective-held-out':failures.append(prefix+'prospective allocation cannot be final')
   if config.get('family') in ['modality','secondary-ocr','semester-reconstruction','answer','quantitative-continuity'] and case.get('rightsReviewed') is not True:failures.append(prefix+'rights review incomplete')
   if config.get('family')!='performance':
    reference=case.get('referenceFile')
    if not reference or not (ROOT/reference).is_file() or sha(ROOT/reference)!=case.get('referenceSha256'):failures.append(prefix+'reference file absent or changed')
    ref_review=case.get('referenceReview',{})
    readers=ref_review.get('readers',[])
    if case.get('referenceStatus')!='independent-human-adjudicated' or len(set(readers))<2 or ref_review.get('adjudicated') is not True:failures.append(prefix+'two independent readers/adjudication missing')
    if config.get('family')=='retrieval' and case.get('referenceKind')!='graded-query-relevance-and-applicability':failures.append(prefix+'independent graded query judgments missing')
   elif config.get('measurementMethodsFrozen') is not True:failures.append(prefix+'performance measurement methods not frozen')
   if not case.get('inputFiles'):failures.append(prefix+'no acquired input files')
   for source in case.get('inputFiles',[]):
    file=ROOT/source['path']
    if not file.is_file() or sha(file)!=source.get('sha256'):failures.append(prefix+'image/input absent or changed')
 return sorted(set(failures))

def prepare(plan,manifest,config,final=False):
 failures=gates(manifest,config,final);family=next((x for x in plan['families'] if x['id']==config.get('family')),None)
 if not family:raise ValueError('Unknown experiment family')
 jobs=[]
 semester_arms={}
 if family['id']=='semester-reconstruction':
  definition=ROOT/family['armDefinitions'];semester=load(definition)
  semester_arms={item['id']:item for item in semester['reconstruction']['arms']}
  if family['arms']!=list('ABCDE') or list(semester_arms)!=list('ABCDE'):failures.append('semester comparison requires the five declared A-E arms')
  if final and not any(item.get('role')=='arm-definitions' and item.get('path')==family['armDefinitions'] and item.get('sha256')==sha(definition) for item in config.get('frozenFiles',[])):failures.append('semester arm definitions not frozen')
  if final and (config.get('stage')!='initial-reconstruction' or config.get('recoveryPolicy')!='disabled' or config.get('answerSynthesis') is not False):failures.append('semester initial extraction must exclude recovery and answer synthesis')
 for case in manifest.get('cases',[]):
  for arm in family['arms']:
   arm_spec=config.get('armAdapters',{}).get(arm)
   if final and (not arm_spec or not arm_spec.get('argv') or not arm_spec.get('inputSelection')):failures.append('frozen adapter/input selection missing: '+arm)
   if final and not any(item.get('role')=='adapter:'+arm for item in config.get('frozenFiles',[])):failures.append('adapter implementation not hashed: '+arm)
   expected_modalities={'ocr-only':['ocr'],'image-only':['image'],'ocr+image':['ocr','image'],'tesseract+image':['ocr','image'],'tesseract+paddle+image':['ocr','image']}.get(arm)
   if final and expected_modalities and (arm_spec or {}).get('inputSelection',{}).get('modalities')!=expected_modalities:failures.append('incorrect modality restriction: '+arm)
   if arm in semester_arms:
    declared=semester_arms[arm]
    expected_selection={'analysisMethod':declared['analysisMethod'],'evidence':declared['allowedInputs']}
    if final and (arm_spec or {}).get('inputSelection')!=expected_selection:failures.append('incorrect semester method/evidence restriction: '+arm)
   jobs.append({'jobId':case['caseId']+'::'+arm,'caseId':case['caseId'],'productGroupId':case['productGroupId'],'split':case['split'],'arm':arm,'family':family['id'],'config':config,'adapter':arm_spec,'inputFiles':case.get('inputFiles',[]),'referenceFile':case.get('referenceFile')})
 return {'schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'claimScope':'final-independent' if final else 'development-preparation-only','state':'BLOCKED' if failures else 'READY','blockers':failures,'manifest':manifest,'jobs':jobs,'finalResult':False}

def retrieval(rows):
 results=[];seen=set()
 for row in rows:
  if row['queryId'] in seen:raise ValueError('duplicate query within one retrieval arm')
  seen.add(row['queryId'])
  k=row.get('k',5)
  if not isinstance(k,int) or isinstance(k,bool) or not 1<=k<=100:raise ValueError('k outside 1..100')
  grades=row['judgments'];ranked=row['rankedIds'][:k]
  if len(set(row['rankedIds']))!=len(row['rankedIds']):raise ValueError('duplicate retrieved IDs')
  if any(not isinstance(v,int) or isinstance(v,bool) or v not in range(4) for v in grades.values()):raise ValueError('relevance grades must be 0..3')
  unjudged=[item for item in ranked if item not in grades]
  eligible=row.get('judgmentStatus')=='independent-human' and row.get('poolComplete') is True and not unjudged
  relevant={key for key,value in grades.items() if value>0};hits=[(index+1,item) for index,item in enumerate(ranked) if grades.get(item,0)>0]
  dcg=sum((2**grades.get(item,0)-1)/math.log2(index+2) for index,item in enumerate(ranked))
  ideal=sum((2**grade-1)/math.log2(index+2) for index,grade in enumerate(sorted(grades.values(),reverse=True)[:k]))
  applicability=row.get('applicability',{})
  if any(value not in ['applicable','not-applicable','unknown'] for value in applicability.values()):raise ValueError('Invalid applicability label')
  results.append({'queryId':row['queryId'],'k':k,'eligible':eligible,'unjudgedIds':unjudged,'relevantDenominator':len(relevant),'relevantRetrieved':len(hits),'recall':len(hits)/len(relevant) if eligible and relevant else None,'reciprocalRank':1/hits[0][0] if eligible and hits else 0 if eligible and relevant else None,'ndcg':dcg/ideal if eligible and ideal else None,'negativeQuery':not relevant,'negativeFalseMatch':bool(ranked) if eligible and not relevant else None,'applicabilityKnownDenominator':sum(applicability.get(item) in ['applicable','not-applicable'] for item in ranked),'inapplicableReturned':sum(applicability.get(item)=='not-applicable' for item in ranked),'unknownApplicabilityIds':[item for item in ranked if applicability.get(item,'unknown')=='unknown']})
 metrics={}
 for name in ['recall','reciprocalRank','ndcg']:
  values=[row[name] for row in results if row[name] is not None];metrics[name]={'mean':sum(values)/len(values) if values else None,'queryDenominator':len(values),'excludedQueries':len(results)-len(values)}
 metrics['negativeQueries']={'denominator':sum(row['eligible'] and row['negativeQuery'] for row in results),'falseMatches':sum(row['negativeFalseMatch'] is True for row in results)}
 return {'perQuery':results,'metrics':metrics,'note':'Metrics conditional on complete declared judgment pool; applicable jurisdiction/population must be judged separately.'}

def quantitative(rows):
 results=[]
 for row in rows:
  expected=row.get('expected');actual=row.get('actual');correct=None
  if expected is not None and actual is not None:
   try:correct=Decimal(str(expected)).is_finite() and Decimal(str(actual)).is_finite() and abs(Decimal(str(expected))-Decimal(str(actual)))<=Decimal(str(row.get('absoluteTolerance',0)))
   except InvalidOperation:raise ValueError('Invalid numeric reference')
  identity=bool(row.get('expectedUnit')) and row.get('expectedBasis') is not None and row.get('expectedUnit')==row.get('actualUnit') and row.get('expectedBasis')==row.get('actualBasis')
  invariants=row.get('invariants',{})
  if any(value is not None and not isinstance(value,bool) for value in invariants.values()):raise ValueError('invariants must be observed booleans or unavailable')
  results.append({'caseId':row['caseId'],'numericCorrect':correct,'unitBasisCorrect':identity,'invariants':invariants,'completeCorrect':correct is True and identity and all(value is True for value in invariants.values()),'missing':actual is None,'referenceStatus':row.get('referenceStatus','unreviewed')})
 return {'perCase':results,'completeCorrect':sum(row['completeCorrect'] for row in results),'denominator':len(results),'independentReferenceDenominator':sum(row['referenceStatus']=='independent-human-adjudicated' for row in results)}

def human_answers(rows):
 accepted=[];pending=[];seen=set()
 for row in rows:
  identity=(row.get('caseId'),row.get('raterCode'),row.get('arm'))
  if identity in seen:raise ValueError('duplicate answer rating by the same reader')
  seen.add(identity)
  scores=row.get('scores',{})
  if row.get('provenance')!='independent-human' or not row.get('raterCode') or any(key not in scores or not isinstance(scores[key],int) or isinstance(scores[key],bool) or scores[key] not in range(5) for key in RUBRIC):pending.append(row.get('caseId'));continue
  accepted.append(row)
 return {'ratings':accepted,'ratingDenominator':len(accepted),'pendingOrInvalid':pending,'note':'One rating is not adjudicated consensus. Preserve rater IDs/disagreement and blinded evidence; no automatic semantic grading.'}

def usage(rows):
 result={}
 for key in USAGE_FIELDS:
  known=[row[key] for row in rows if row.get(key) is not None]
  if any(not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) or value<0 for value in known):raise ValueError('Invalid usage metric: '+key)
  result[key]={'reportedSum':sum(known) if known else None,'reportedCalls':len(known),'missingCalls':len(rows)-len(known),'completeTotal':sum(known) if len(known)==len(rows) and rows else None}
 return {'calls':len(rows),'byMetric':result,'failedCalls':sum(row.get('status')=='failed' for row in rows),'byStage':{stage:sum(str(row.get('stage') or 'unclassified')==stage for row in rows) for stage in sorted({str(row.get('stage') or 'unclassified') for row in rows})},'note':'Summed provider/tool work is not end-to-end wall time. Cached tokens are included in prompt counts, not added again. Estimated and billed costs are distinct.'}

def score(receipt):
 retrieval_rows=receipt.get('retrieval',[]);usage_rows=receipt.get('usage',[])
 by_arm={arm:retrieval([row for row in retrieval_rows if str(row.get('arm') or 'unclassified')==arm]) for arm in sorted({str(row.get('arm') or 'unclassified') for row in retrieval_rows})}
 by_stage={stage:usage([row for row in usage_rows if str(row.get('stage') or 'unclassified')==stage]) for stage in sorted({str(row.get('stage') or 'unclassified') for row in usage_rows})}
 by_task={task:usage([row for row in usage_rows if str(row.get('taskId') or 'unclassified')==task]) for task in sorted({str(row.get('taskId') or 'unclassified') for row in usage_rows})}
 return {'schemaVersion':1,'finalResult':False,'retrievalByArm':by_arm,'answers':human_answers(receipt.get('answers',[])),'quantitative':quantitative(receipt.get('quantitative',[])),'usage':usage(usage_rows),'usageByStage':by_stage,'usageByTask':by_task,'reconstruction':'Use scripts/evaluation/score-reconstruction.mts with existing shared OCR contracts; no parallel nutrient scorer.'}

def execute(prepared,adapter,output,allow_provider=False):
 if prepared['state']!='READY':raise ValueError('Blocked plan cannot execute')
 if not adapter or not all(isinstance(arg,str) for arg in adapter):raise ValueError('Adapter must be a JSON argv array')
 if not allow_provider:raise ValueError('Execution is explicit: --allow-adapter required; adapter may invoke providers')
 output=Path(output);output.mkdir(parents=True,exist_ok=True);receipts=[]
 for index,job in enumerate(prepared['jobs']):
  drift=gates(prepared.get('manifest',{}),job.get('config',{}),prepared['claimScope']=='final-independent') if prepared['claimScope']=='final-independent' else []
  if drift:raise ValueError('Frozen run inputs changed: '+'; '.join(drift))
  if prepared['claimScope']=='final-independent':
   frozen_adapter=job.get('config',{}).get('armAdapters',{}).get(job['arm'])
   if not frozen_adapter or job.get('adapter')!=frozen_adapter or adapter!=frozen_adapter['argv']:raise ValueError('Runtime adapter differs from frozen arm configuration')
  try:
   run=subprocess.run(adapter,input=json.dumps(job),text=True,capture_output=True,shell=False,timeout=180,cwd=ROOT)
   # Trusted frozen adapters may retain controlled response/failure receipts even
   # when the provider output could not be validated. Raw stderr stays excluded.
   value=json.loads(run.stdout) if run.stdout.strip() else None
   result={'jobId':job['jobId'],'status':'completed' if run.returncode==0 else 'failed','exitCode':run.returncode,'receipt':value,'errorClass':None if run.returncode==0 else 'adapter-exit'}
   if run.returncode==0 and not isinstance(value,dict):result.update(status='failed',errorClass='invalid-receipt')
   elif run.returncode==0 and prepared['claimScope']=='final-independent':
    required={'actualModel':str,'actualGenerationConfig':dict,'fallbackOccurred':bool,'actualInputSelection':dict}
    if any(key not in value or not isinstance(value[key],kind) for key,kind in required.items()):result.update(status='noncomparable',errorClass='invalid-receipt')
    elif value['actualModel']!=job['config']['model'] or value['actualGenerationConfig']!=job['config']['generationConfig'] or value['fallbackOccurred'] or value['actualInputSelection']!=job['adapter']['inputSelection']:result.update(status='noncomparable',errorClass='model-config-modality-or-route-changed')
    elif job.get('family')=='semester-reconstruction' and (value.get('actualStage')!='initial-reconstruction' or type(value.get('recoveryCalls')) is not int or value.get('recoveryCalls')!=0 or type(value.get('answerGenerationCalls')) is not int or value.get('answerGenerationCalls')!=0):result.update(status='noncomparable',errorClass='recovery-or-answer-contaminated-initial-extraction')
  except (subprocess.TimeoutExpired,json.JSONDecodeError,OSError) as error:result={'jobId':job['jobId'],'status':'failed','errorClass':type(error).__name__}
  # Adapter raw stderr/prompts/environment are not copied into shareable receipts.
  write_new(output/(str(index).zfill(4)+'.json'),result);receipts.append(result)
 write_new(output/'run.json',{'jobs':len(receipts),'failed':sum(row['status']!='completed' for row in receipts),'claimScope':prepared['claimScope'],'finalResult':False})

def main():
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
 for name in ['prepare','freeze']:
  child=sub.add_parser(name);child.add_argument('--plan',default=str(ROOT/'data/evaluation/experiment-plan.json'));child.add_argument('--manifest',required=True);child.add_argument('--config',required=True);child.add_argument('--output',required=True)
 child=sub.add_parser('score');child.add_argument('--receipts',required=True);child.add_argument('--output',required=True)
 child=sub.add_parser('execute');child.add_argument('--prepared',required=True);child.add_argument('--adapter-argv',required=True);child.add_argument('--output',required=True);child.add_argument('--allow-adapter',action='store_true')
 args=parser.parse_args()
 if args.command in ['prepare','freeze']:write_new(args.output,prepare(load(args.plan),load(args.manifest),load(args.config),args.command=='freeze'))
 elif args.command=='score':write_new(args.output,score(load(args.receipts)))
 else:execute(load(args.prepared),load(args.adapter_argv),args.output,args.allow_adapter)

if __name__=='__main__':main()
