import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import study_ops as ops

class StudyOperations(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.asset=self.root/'artifact.bin';self.asset.write_bytes(b'SYNTHETIC STRUCTURAL FIXTURE; not a photo or annotation')
        self.pointer={'path':'artifact.bin','sha256':ops.sha(self.asset)}
        self.g={'productGroupId':'synthetic-1','familyGroupId':'synthetic-family','sourceProductUrl':'https://example.org/fixture','retrievedAt':'2026-10-26T00:00:00Z','variantId':'v1','images':[{'imageId':'synthetic-image','privateLocalFile':'artifact.bin','sha256':ops.sha(self.asset),'byteLength':self.asset.stat().st_size}]}
        self.d={k+'Review':self.pointer for k in ('rights','variant','market','layout','exposure','split')}
        for code in ('A','B','C'): (self.root/f'pass-{code}.json').write_text('SYNTHETIC '+code)
        self.d.update(familyReviewComplete=True,rightsDecision='approved-local-study',variantId='v1',packagingRevision='synthetic-r1',split='held-out',splitLocked=True,previousModelExposure=False,readerPasses=[{'path':f'pass-{c}.json','sha256':ops.sha(self.root/f'pass-{c}.json'),'reviewerCode':'SYNTHETIC-'+c,'independentHuman':True} for c in ('A','B')],adjudication={**self.pointer,'reviewerCode':'SYNTHETIC-C','unresolvedDisagreements':0},referenceCoverage={k:'human-reviewed-present' for k in ('nutrition','ingredients','allergens','additives','warnings','claims','serving','identity')})
    def report(self,d=None,g=None):
        return ops.readiness({'products':[g or self.g]},self.root,{'groups':{'synthetic-1':d or self.d}})
    def codes(self,r):return {x['code'] for x in r['groups'][0]['blockers']}
    def test_structural_ready_not_scientific_claim(self):
        r=self.report();self.assertEqual(r['status'],'READY');self.assertFalse(r['hiddenLabelsParsed'])
    def test_missing_rights_and_premature_freeze(self):
        d=copy.deepcopy(self.d);d.pop('rightsReview');d['rightsDecision']='pending';d['freezeApproved']=True
        self.assertIn('premature-freeze-approval',self.codes(self.report(d)))
    def test_corrupt_image_hash(self):
        g=copy.deepcopy(self.g);g['images'][0]['sha256']='0'*64
        self.assertIn('image-integrity:synthetic-image',self.codes(self.report(g=g)))
    def test_variant_conflict(self):
        d={**self.d,'variantId':'v2'};self.assertIn('variant-declaration-mismatch',self.codes(self.report(d)))
    def test_reader_incomplete(self):
        d={**self.d,'readerPasses':self.d['readerPasses'][:1]};self.assertIn('two-independent-reader-passes',self.codes(self.report(d)))
    def test_family_split_and_duplicate_image(self):
        g={**self.g,'productGroupId':'synthetic-2'}
        r=ops.readiness({'products':[self.g,g]},self.root,{'groups':{'synthetic-1':self.d,'synthetic-2':{**self.d,'split':'development'}}})
        self.assertIn('family-crosses-splits',self.codes(r));self.assertIn('image-reused-across-groups',self.codes(r))
    def test_path_escape(self):
        with self.assertRaises(ValueError):ops.local(self.root,'../private-labels.json')
    def response(self):
        c,_=ops.definitions();case=c['conversations'][0];t=case['turns'][0]
        return {'responseId':'synthetic-response','conversationId':case['id'],'turn':t['turn'],'questionSha256':t['sourceTextSha256'],'buildCommit':'a'*40,'contextSha256':'b'*64,'displayedResponse':'SYNTHETIC STRUCTURAL RESPONSE. No food advice.','responseSha256':hashlib.sha256(b'SYNTHETIC STRUCTURAL RESPONSE. No food advice.').hexdigest(),'treatment':'knowledge-on','sourceReceipts':[],'status':'completed'}
    def test_blind_key_separation_and_pending(self):
        r=ops.blind_responses([self.response()],42)
        self.assertNotIn('treatment',r['reviewerPackets'][0]);self.assertNotIn('buildCommit',r['reviewerPackets'][0]);self.assertEqual(ops.validate_ratings([],r['privateJoinKey'])['status'],'PENDING')
    def test_wrong_question_and_changed_output(self):
        for key in ('questionSha256','responseSha256'):
            r=self.response();r[key]='0'*64
            with self.assertRaises(ValueError):ops.blind_responses([r],42)
    def rating(self):
        b=ops.blind_responses([self.response()],42);r=b['reviewerPackets'][0]['rating'];r.update(raterCode='SYNTHETIC-A',provenance='independent-human',assessedAt='2026-10-26T00:00:00Z',scores={d:3 for d in b['rubric']},evidencePointers=['synthetic fixture only'])
        return r,b['privateJoinKey']
    def test_rating_wrong_join(self):
        r,k=self.rating();r['contextSha256']='0'*64
        with self.assertRaises(ValueError):ops.validate_ratings([r],k)
    def test_no_model_or_boolean_rating(self):
        r,k=self.rating();r['provenance']='model'
        with self.assertRaises(ValueError):ops.validate_ratings([r],k)
        r,k=self.rating();r['scores']['uncertainty']=True
        with self.assertRaises(ValueError):ops.validate_ratings([r],k)
    def test_missing_na_reason_and_duplicate(self):
        r,k=self.rating();r['scores']['uncertainty']=None
        with self.assertRaises(ValueError):ops.validate_ratings([r],k)
        r,k=self.rating()
        with self.assertRaises(ValueError):ops.validate_ratings([r,r],k)
    def test_two_ratings_require_adjudication(self):
        r,k=self.rating();r2=copy.deepcopy(r);r2['raterCode']='SYNTHETIC-B';r2['scores']['uncertainty']=1
        result=ops.validate_ratings([r,r2],k)
        self.assertEqual(result['status'],'REQUIRES_HUMAN_ADJUDICATION');self.assertTrue(any(d['disagreement'] for d in result['perResponseDimensions']))
    def test_pair_missing_and_context_drift(self):
        a=self.response();a.update(model='synthetic-model',generationConfigSha256='c'*64,basePromptSha256='d'*64,packageSnapshotSha256='e'*64,toolManifestSha256='f'*64,fallbackOccurred=False,externalKnowledgeCalls=0)
        b={**a,'responseId':'other','treatment':'knowledge-off','contextSha256':'0'*64}
        report=ops.pair_audit([a,b]);self.assertEqual(report['status'],'BLOCKED')
        self.assertTrue(any('noncomparable:contextSha256' in r['reasons'] for r in report['pairs']))
    def test_export_keeps_key_outside_reviewer(self):
        r=self.response();r['contextArtifact']=self.pointer;r['contextSha256']=self.pointer['sha256']
        output=self.root/'.data/review'
        ops.export_review([r],3,output,self.root)
        self.assertTrue((output/'custodian/join-key.json').is_file())
        text=(output/'reviewer/packets.json').read_text()
        self.assertNotIn('knowledge-on',text);self.assertNotIn('buildCommit',text)
        with self.assertRaises(FileExistsError):ops.export_review([r],3,output,self.root)
    def test_critical_quote_requires_actual_matching_response(self):
        r,k=self.rating();r['criticalErrors']=[{'responseSpan':'not in response','evidencePointer':'fixture','reason':'negative'}]
        with self.assertRaises(ValueError):ops.validate_ratings([r],k)
        with self.assertRaises(ValueError):ops.validate_ratings([r],k,[self.response()])
        r['criticalErrors'][0]['responseSpan']='SYNTHETIC STRUCTURAL RESPONSE.'
        self.assertEqual(ops.validate_ratings([r],k,[self.response()])['criticalErrors'],1)
    def test_changed_response_cannot_support_a_quote(self):
        r,k=self.rating();r['criticalErrors']=[{'responseSpan':'SYNTHETIC','evidencePointer':'fixture','reason':'negative'}]
        response=self.response();response['displayedResponse']='SYNTHETIC changed'
        with self.assertRaises(ValueError):ops.validate_ratings([r],k,[response])
    def test_wrong_context_cannot_support_a_quote(self):
        r,k=self.rating();r['criticalErrors']=[{'responseSpan':'SYNTHETIC','evidencePointer':'fixture','reason':'negative'}]
        response=self.response();response['contextSha256']='0'*64
        with self.assertRaises(ValueError):ops.validate_ratings([r],k,[response])
    def test_separate_review_root_does_not_require_writing_original(self):
        review_root=self.root/'reviews';review_root.mkdir()
        for p in self.root.glob('*.bin'): (review_root/p.name).write_bytes(p.read_bytes())
        for p in self.root.glob('pass-*.json'): (review_root/p.name).write_bytes(p.read_bytes())
        report=ops.readiness({'products':[self.g]},self.root,{'groups':{'synthetic-1':self.d}},review_root)
        self.assertEqual(report['status'],'READY')
        (review_root/'pass-A.json').write_text('changed review')
        report=ops.readiness({'products':[self.g]},self.root,{'groups':{'synthetic-1':self.d}},review_root)
        self.assertNotEqual(report['status'],'READY')
    def test_reused_pass_rejected(self):
        d=copy.deepcopy(self.d);d['readerPasses'][1]['path']=d['readerPasses'][0]['path']
        self.assertIn('reader-pass-artifact-reused',self.codes(self.report(d)))
if __name__=='__main__':unittest.main()

