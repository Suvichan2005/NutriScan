import copy
import unittest
import receipt_ops as receipts

class ReceiptOperations(unittest.TestCase):
    def sample(self):
        cfg={'model':'synthetic-model','generationConfig':{'temperature':0},'implementationCommit':'a'*40,'freezeId':'synthetic-freeze','promptHash':'b'*64,'sourceSnapshotHash':'c'*64,'toolAccessHash':'d'*64}
        job={'jobId':'g::A','productGroupId':'g','arm':'A','config':cfg,'adapter':{'inputSelection':{'analysisMethod':'tesseract-text'}},'inputFiles':[{'path':'fixture.json','sha256':'e'*64}]}
        value={'actualModel':cfg['model'],'actualGenerationConfig':cfg['generationConfig'],'fallbackOccurred':False,'actualInputSelection':job['adapter']['inputSelection'],'actualStage':'initial-reconstruction','recoveryCalls':0,'answerGenerationCalls':0,'studyBinding':{**cfg,'inputHashes':{'fixture.json':'e'*64}},'providerCallMetadata':[{'event':'provider_response','usage':{'promptTokenCount':10},'elapsedMs':2}]}
        return {'jobs':[job],'claimScope':'synthetic-structure-only'},[{'jobId':job['jobId'],'status':'completed','receipt':value}]
    def test_unknown_cost_not_zero(self):
        p,r=self.sample();result=receipts.audit(p,r)
        self.assertEqual(result['status'],'READY_FOR_EXISTING_SCORER');self.assertIsNone(result['usage']['byMetric']['billedUsd']['completeTotal']);self.assertIsNone(result['usage']['byMetric']['outputTokens']['completeTotal'])
    def test_drift_recovery_and_missing_binding(self):
        for k,v in [('actualModel','other'),('fallbackOccurred',True),('recoveryCalls',1),('studyBinding',{})]:
            p,r=self.sample();r[0]['receipt'][k]=v;self.assertEqual(receipts.audit(p,r)['status'],'BLOCKED')
    def test_unequal_subsets_and_duplicate_receipt(self):
        p,r=self.sample();j=copy.deepcopy(p['jobs'][0]);j.update(jobId='g::B',arm='B');p['jobs'].append(j)
        result=receipts.audit(p,r);self.assertEqual(result['completePairedProductGroups'],[]);self.assertEqual(result['productGroupDenominators'],{'A':1,'B':0});self.assertEqual(result['missingJobs'],['g::B'])
        with self.assertRaises(ValueError):receipts.audit(p,r+r)
    def test_unknown_job(self):
        p,r=self.sample();r[0]['jobId']='unknown'
        with self.assertRaises(ValueError):receipts.audit(p,r)
if __name__=='__main__':unittest.main()
