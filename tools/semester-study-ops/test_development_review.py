import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import study_ops as ops
import prepare_development_review as prep

class DevelopmentReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name);self.root=self.base/'original';self.root.mkdir();self.pilot=self.root/'.data/semester-conversation-pilot-20261026';self.pilot.mkdir(parents=True)
        self.snapshot=self.root/'synthetic-package.json';self.snapshot.write_text('{}');self.cases=[]
        for case in ops.definitions()[0]['conversations']:
            self.cases.append({'id':case['id'],'turns':case['turns'],'profile':{'fictional':True},'snapshotFile':'synthetic-package.json','packageSnapshotSha256':ops.sha(self.snapshot)})
            for t in case['turns']:
                raw={'question':t['userText'],'packageSnapshotSha256':ops.sha(self.snapshot),'summary':{'caseId':case['id'],'turn':t['turn'],'status':'completed','diagnosticId':'SYNTHETIC-'+case['id']+'-'+str(t['turn'])},'response':{'answer':'SYNTHETIC STRUCTURAL RESPONSE. Not a model answer or clinical assessment.','agentEvidence':[]},'calls':[]}
                (self.pilot/f"{case['id']}-{t['turn']}.json").write_text(json.dumps(raw))
        (self.pilot/'cases.json').write_text(json.dumps(self.cases));(self.pilot/'freeze.json').write_text(json.dumps({'implementationCommit':'a'*40}));(self.pilot/'execution-summary.json').write_text(json.dumps({'implementationCommit':'a'*40}));(self.pilot/'run.mts').write_text('// SYNTHETIC RUNNER FIXTURE')
        self.output=self.base/'.data/review'
    def test_full_portfolio_prepared_without_ratings(self):
        result=prep.prepare(self.root,self.output,True);self.assertEqual(result['completedResponses'],27);self.assertEqual(result['providerCallsMade'],0)
        manifest=ops.load(self.output/'manifest.json');self.assertEqual(manifest['humanRatings'],'PENDING');self.assertEqual(manifest['browserRenderedAnswers'],'NOT_OBSERVED')
        records=ops.load(self.output/'response-records.json');third=next(r for r in records if r['conversationId']=='M-D' and r['turn']==3);context=ops.load(self.output/third['contextArtifact']['path']);self.assertEqual(len(context['conversationContext']),2)
        self.assertEqual(ops.sha(self.output/third['contextArtifact']['path']),third['contextSha256'])
    def test_explicit_optin_and_snapshot_corruption(self):
        with self.assertRaises(ValueError):prep.prepare(self.root,self.output)
        self.snapshot.write_text('{"changed":true}')
        with self.assertRaises(ValueError):prep.prepare(self.root,self.output,True)
        self.assertFalse(self.output.exists())
    def test_question_drift_rejected(self):
        self.cases[0]['turns'][0]['userText']='changed question';(self.pilot/'cases.json').write_text(json.dumps(self.cases))
        with self.assertRaises(ValueError):prep.prepare(self.root,self.output,True)
    def test_original_corpus_output_rejected(self):
        with self.assertRaises(ValueError):prep.prepare(self.root,self.root/'.data/output',True)
if __name__=='__main__':unittest.main()
