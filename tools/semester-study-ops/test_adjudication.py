import copy
import unittest
import adjudication as adj
import study_ops as ops
import test_study_ops as fixtures

class AdjudicationOperations(unittest.TestCase):
    def fixture(self):
        helper=fixtures.StudyOperations();r,k=helper.rating();b=copy.deepcopy(r);b['raterCode']='SYNTHETIC-B';b['scores']['uncertainty']=None;b['notApplicableReasons']={'uncertainty':'Synthetic N/A example'}
        rows=[r,b];j=adj.disagreement_packet(rows,k)['responses'][0]
        d={x:j[x] for x in ('blindResponseId','contextSha256','responseSha256','ratingSetSha256')}
        d.update(adjudicatorCode='SYNTHETIC-C',provenance='independent-human',assessedAt='2026-10-26T10:00:00Z',reason='Synthetic structural decision, not actual review',evidencePointers=['synthetic-fixture'],scores=copy.deepcopy(r['scores']),dimensionReasons={'uncertainty':'Synthetic N/A disagreement resolved'},criticalErrorDecisions=[])
        return rows,k,d
    def test_na_disagreement_preserved(self):
        rows,k,d=self.fixture();before=ops.canonical(rows)
        packet=adj.disagreement_packet(rows,k);self.assertIn('uncertainty',packet['responses'][0]['disagreements'])
        self.assertEqual(adj.adjudicate(rows,k,[d])['status'],'ADJUDICATED_RECORDS_ONLY');self.assertEqual(before,ops.canonical(rows))
    def test_drift_and_same_reviewer_rejected(self):
        for field,value in [('ratingSetSha256','0'*64),('adjudicatorCode','SYNTHETIC-A'),('contextSha256','0'*64)]:
            rows,k,d=self.fixture();d[field]=value
            with self.assertRaises(ValueError):adj.adjudicate(rows,k,[d])
    def test_pending_readers_and_unexplained_resolution(self):
        rows,k,d=self.fixture()
        with self.assertRaises(ValueError):adj.adjudicate(rows[:1],k,[d])
        d['dimensionReasons']={}
        with self.assertRaises(ValueError):adj.adjudicate(rows,k,[d])
    def test_critical_error_cannot_disappear(self):
        rows,k,d=self.fixture();rows[0]['criticalErrors']=[{'responseSpan':'SYNTHETIC','evidencePointer':'fixture','reason':'structural example'}]
        responses=[fixtures.StudyOperations().response()]
        d['ratingSetSha256']=adj.disagreement_packet(rows,k,responses)['responses'][0]['ratingSetSha256']
        with self.assertRaises(ValueError):adj.adjudicate(rows,k,[d],responses)
        d['criticalErrorDecisions']=[{'reviewerCode':'SYNTHETIC-A','index':0,'decision':'unresolved','reason':'Synthetic pending evidence','evidencePointer':'fixture'}]
        self.assertEqual(adj.adjudicate(rows,k,[d],responses)['status'],'PENDING')
    def test_na_summary_and_early_decision(self):
        rows,k,d=self.fixture();report=ops.validate_ratings(rows,k)
        dim=next(x for x in report['perResponseDimensions'] if x['dimension']=='uncertainty')
        self.assertEqual(dim['notApplicable'],1);self.assertTrue(dim['disagreement']);self.assertEqual(dim['n'],1)
        d['assessedAt']='2026-10-25T00:00:00Z'
        with self.assertRaises(ValueError):adj.adjudicate(rows,k,[d])
    def test_duplicate_key_rejected(self):
        rows,k,d=self.fixture()
        with self.assertRaises(ValueError):ops.validate_ratings(rows,k+k)
if __name__=='__main__':unittest.main()
