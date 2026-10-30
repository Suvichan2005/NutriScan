"""Synthetic contract tests, never independent product accuracy evidence."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('run_experiments.py'));runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class EvaluationTests(unittest.TestCase):
 def test_product_group_leakage_and_exposure(self):
  rows={'cases':[{'caseId':'a','productGroupId':'same','split':'development','developmentExposed':True},{'caseId':'b','productGroupId':'same','split':'held-out','developmentExposed':True}]}
  errors=runner.validate_cases(rows);self.assertEqual(len(errors),2)
 def test_final_blockers_are_not_results(self):
  plan=runner.load(runner.ROOT/'data/evaluation/experiment-plan.json')
  ready=runner.prepare(plan,{'cases':[{'caseId':'a','productGroupId':'g','split':'development'}]},{'family':'modality'},False)
  self.assertEqual(len(ready['jobs']),3);self.assertEqual(ready['state'],'READY');self.assertFalse(ready['finalResult'])
  blocked=runner.prepare(plan,{'cases':[{'caseId':'a','productGroupId':'g','split':'held-out'}]},{'family':'modality'},True)
  self.assertEqual(blocked['state'],'BLOCKED');self.assertIn('a: two independent readers/adjudication missing',blocked['blockers'])
  blocked=runner.prepare(plan,{'cases':[{'caseId':'a','productGroupId':'g','split':'held-out'}]},{'family':'retrieval'},True)
  self.assertIn('BLOCKED ON A: required capabilities not frozen/verified',blocked['blockers'])
 def test_semester_methods_bind_five_arms_and_block_leakage_or_unfrozen_recovery(self):
  from unittest.mock import patch
  plan=runner.load(runner.ROOT/'data/evaluation/experiment-plan.json')
  definitions=runner.load(runner.ROOT/'data/evaluation/semester-experiments.json')
  config={'family':'semester-reconstruction','stage':'initial-reconstruction','recoveryPolicy':'disabled','answerSynthesis':False,'frozenFiles':[{'role':'arm-definitions','path':'data/evaluation/semester-experiments.json','sha256':runner.sha(runner.ROOT/'data/evaluation/semester-experiments.json')}],'armAdapters':{a['id']:{'argv':['fixture-only'],'inputSelection':{'analysisMethod':a['analysisMethod'],'evidence':a['allowedInputs']}} for a in definitions['reconstruction']['arms']}}
  config['frozenFiles'] += [{'role':'adapter:'+a,'path':'fixture-not-executed','sha256':'fixture'} for a in 'ABCDE']
  manifest={'cases':[{'caseId':'not-a-photo','productGroupId':'fixture','split':'development'}]}
  with patch.object(runner,'gates',return_value=[]):
   prepared=runner.prepare(plan,manifest,config,True)
   self.assertEqual(prepared['state'],'READY');self.assertEqual([j['arm'] for j in prepared['jobs']],list('ABCDE'))
   config['armAdapters']['A']['inputSelection']['evidence'] += ['original-images']
   self.assertIn('incorrect semester method/evidence restriction: A',runner.prepare(plan,manifest,config,True)['blockers'])
   config['recoveryPolicy']='enabled'
   self.assertIn('semester initial extraction must exclude recovery and answer synthesis',runner.prepare(plan,manifest,config,True)['blockers'])
   config['frozenFiles']=[]
   self.assertIn('semester arm definitions not frozen',runner.prepare(plan,manifest,config,True)['blockers'])
 def test_semester_receipts_do_not_accept_hidden_recovery_or_answer_calls(self):
  import sys
  from unittest.mock import patch
  base={'actualModel':'fixture','actualGenerationConfig':{},'actualInputSelection':{'analysisMethod':'vision','evidence':['original-images']},'fallbackOccurred':False,'actualStage':'initial-reconstruction','recoveryCalls':0,'answerGenerationCalls':0}
  with tempfile.TemporaryDirectory() as directory:
   for index,change in enumerate([{}, {'recoveryCalls':1}, {'answerGenerationCalls':1}, {'actualStage':'full-conversation'}, {'recoveryCalls':None}, {'recoveryCalls':False}]):
    value={**base,**change};argv=[sys.executable,'-c','import sys;sys.stdout.write('+repr(json.dumps(value))+')']
    adapter={'argv':argv,'inputSelection':base['actualInputSelection']};config={'model':'fixture','generationConfig':{},'armAdapters':{'C':adapter}}
    plan={'state':'READY','claimScope':'final-independent','manifest':{},'jobs':[{'jobId':'fixture','family':'semester-reconstruction','config':config,'arm':'C','adapter':adapter}]}
    output=Path(directory)/str(index)
    with patch.object(runner,'gates',return_value=[]):runner.execute(plan,argv,output,True)
    result=json.loads((output/'0000.json').read_text())
    self.assertEqual(result['status'],'completed' if index==0 else 'noncomparable')
 def test_retrieval_positive_negative_unknown_and_duplicates(self):
  rows=[{'queryId':'positive','judgments':{'a':3,'b':1,'c':0},'rankedIds':['c','a'],'judgmentStatus':'independent-human','poolComplete':True}, {'queryId':'negative','judgments':{'c':0},'rankedIds':['c'],'judgmentStatus':'independent-human','poolComplete':True}, {'queryId':'unknown','judgments':{'a':3},'rankedIds':['unjudged'],'judgmentStatus':'independent-human','poolComplete':True}]
  result=runner.retrieval(rows);self.assertEqual(result['perQuery'][0]['recall'],0.5);self.assertEqual(result['perQuery'][0]['reciprocalRank'],0.5);self.assertEqual(result['metrics']['negativeQueries'],{'denominator':1,'falseMatches':1});self.assertFalse(result['perQuery'][2]['eligible']);self.assertIsNone(result['perQuery'][2]['ndcg'])
  with self.assertRaises(ValueError):runner.retrieval([{'queryId':'duplicate','judgments':{},'rankedIds':['a','a']}])
 def test_numbers_require_units_basis_and_stale_state_invariants(self):
  row={'caseId':'volume','expected':1.95,'actual':1.95,'expectedUnit':'g','actualUnit':'g','expectedBasis':{'amount':75,'unit':'ml'},'actualBasis':{'amount':75,'unit':'ml'},'invariants':{'correctionWins':True},'referenceStatus':'developer'}
  self.assertTrue(runner.quantitative([row])['perCase'][0]['completeCorrect'])
  row['invariants']['correctionWins']=False;self.assertFalse(runner.quantitative([row])['perCase'][0]['completeCorrect'])
  row['actual']=None;self.assertTrue(runner.quantitative([row])['perCase'][0]['missing'])
  row['actual']=1.95;row['actualUnit']='mg';self.assertFalse(runner.quantitative([row])['perCase'][0]['unitBasisCorrect'])
 def test_usage_missing_is_not_zero_and_cache_not_added(self):
  result=runner.usage([{'promptTokens':100,'cachedPromptTokens':25,'estimatedUsd':0,'status':'completed'},{'promptTokens':None,'estimatedUsd':None,'status':'failed'}])
  self.assertEqual(result['byMetric']['promptTokens']['reportedSum'],100);self.assertIsNone(result['byMetric']['promptTokens']['completeTotal']);self.assertEqual(result['failedCalls'],1)
  self.assertEqual(result['byStage'],{'unclassified':2})
 def test_prose_is_not_automatically_judged(self):
  result=runner.human_answers([{'caseId':'generated','provenance':'model','scores':dict.fromkeys(runner.RUBRIC,4)}]);self.assertEqual(result['ratingDenominator'],0);self.assertEqual(result['pendingOrInvalid'],['generated'])
 def test_adapter_requires_explicit_action_and_retains_failures(self):
  with tempfile.TemporaryDirectory() as directory:
   plan={'state':'READY','claimScope':'development-preparation-only','jobs':[{'jobId':'a'}]}
   with self.assertRaises(ValueError):runner.execute(plan,['unused'],Path(directory)/'out')
   import sys
   runner.execute(plan,[sys.executable,'-c','import sys,json;print(json.dumps({"privateRecords":[{"path":"controlled-response.json","sha256":"fixture"}],"code":"invalid-output"}));sys.exit(2)'],Path(directory)/'out',True)
   receipt=json.loads((Path(directory)/'out/0000.json').read_text());self.assertEqual(receipt['status'],'failed');self.assertEqual(receipt['exitCode'],2)
   self.assertEqual(receipt['receipt']['code'],'invalid-output');self.assertEqual(receipt['receipt']['privateRecords'][0]['path'],'controlled-response.json')
 def test_outputs_are_write_once(self):
  with tempfile.TemporaryDirectory() as directory:
   file=Path(directory)/'receipt.json';runner.write_new(file,{'finalResult':False})
   with self.assertRaises(FileExistsError):runner.write_new(file,{})
 def test_final_adapter_requires_object_and_complete_comparability_metadata(self):
  import sys
  from unittest.mock import patch
  complete={'actualModel':'fixture','actualGenerationConfig':{'temperature':0},'actualInputSelection':{'modalities':['ocr']},'fallbackOccurred':False}
  examples=[None,[],{}, {key:value for key,value in complete.items() if key!='fallbackOccurred'},complete]
  with tempfile.TemporaryDirectory() as directory:
   for index,value in enumerate(examples):
    argv=[sys.executable,'-c','import sys;sys.stdout.write('+repr(json.dumps(value))+')']
    adapter={'argv':argv,'inputSelection':{'modalities':['ocr']}}
    config={'model':'fixture','generationConfig':{'temperature':0},'armAdapters':{'ocr-only':adapter}}
    plan={'state':'READY','claimScope':'final-independent','manifest':{},'jobs':[{'jobId':'a','config':config,'arm':'ocr-only','adapter':adapter}]}
    output=Path(directory)/str(index)
    # Freeze integrity has a separate real-file mutation test; isolate stdout validation here.
    with patch.object(runner,'gates',return_value=[]):runner.execute(plan,argv,output,True)
    result=json.loads((output/'0000.json').read_text())
    if index<len(examples)-1:
     self.assertNotEqual(result['status'],'completed');self.assertEqual(result['errorClass'],'invalid-receipt');self.assertEqual(json.loads((output/'run.json').read_text())['failed'],1)
    else:self.assertEqual(result['status'],'completed')
 def test_freeze_detects_post_freeze_file_change_and_performance_needs_no_nutrition_labels(self):
  with tempfile.TemporaryDirectory() as directory:
   file=Path(directory)/'input.json';file.write_text('{}');digest=runner.sha(file)
   import subprocess
   commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=runner.ROOT,text=True).strip()
   config={'family':'performance','model':'fixture','generationConfig':{'temperature':0},'freezeId':'fixture-only','implementationCommit':commit,'promptHash':digest,'sourceSnapshotHash':digest,'toolAccessHash':digest,'measurementMethodsFrozen':True,'frozenFiles':[{'role':role,'path':str(file),'sha256':digest} for role in ['prompt','tools','sources']]}
   manifest={'splitLock':'locked','splitReview':{'reviewerCode':'fixture-reviewer','artifactFile':str(file),'artifactSha256':digest},'cases':[{'caseId':'a','productGroupId':'g','split':'held-out','inputFiles':[{'path':str(file),'sha256':digest}]}]}
   self.assertEqual(runner.gates(manifest,config,True),[])
   file.write_text('{"changed":true}')
   self.assertTrue(any('changed' in message for message in runner.gates(manifest,config,True)))
   prepared={'state':'READY','claimScope':'final-independent','manifest':manifest,'jobs':[{'jobId':'a','config':config,'arm':'initial'}]}
   with self.assertRaisesRegex(ValueError,'Frozen run inputs changed'):runner.execute(prepared,['unused'],Path(directory)/'out',True)

 def test_retrieval_precision_fixed_k_and_unjudged_abstention(self):
  judged={'queryId':'judged','rankedIds':['good','bad'],'judgments':{'good':3,'bad':0},'judgmentStatus':'independent-human','poolComplete':True,'k':5}
  r=runner.retrieval([judged])['perQuery'][0]
  self.assertEqual(r['precisionAtK'],.2);self.assertEqual(r['precisionReturned'],.5)
  unknown={**judged,'queryId':'unjudged','judgments':{},'judgmentStatus':'unjudged','poolComplete':False}
  r=runner.retrieval([unknown])['perQuery'][0]
  self.assertIsNone(r['precisionAtK']);self.assertIsNone(r['precisionReturned'])
  empty={**judged,'queryId':'negative','rankedIds':[],'judgments':{}}
  r=runner.retrieval([empty])['perQuery'][0]
  self.assertEqual(r['precisionAtK'],0);self.assertIsNone(r['precisionReturned']);self.assertFalse(r['negativeFalseMatch'])

if __name__=='__main__':unittest.main()
