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
   runner.execute(plan,[sys.executable,'-c','import sys;sys.exit(2)'],Path(directory)/'out',True)
   receipt=json.loads((Path(directory)/'out/0000.json').read_text());self.assertEqual(receipt['status'],'failed');self.assertEqual(receipt['exitCode'],2)
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

if __name__=='__main__':unittest.main()
