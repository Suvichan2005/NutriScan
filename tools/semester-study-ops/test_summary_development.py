import json
import unittest
import test_development_review as fixtures
import summarize_development as summary

class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.DevelopmentReviewTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups);self.pilot=self.fixture.pilot;rows=[]
        for case in self.fixture.cases:
            for t in case['turns']:
                f=self.pilot/f"{case['id']}-{t['turn']}.json";r=json.loads(f.read_text());r['toolCalls']=[];r['summary'].update(elapsedMs=100*t['turn'],generations=0,sourceIds=[],actualModels=['synthetic'],actualTiers=['free'],fallbackOccurred=False,inputTokens=0,outputTokens=0,photoParts=0,withheldQuantitySentences=0);f.write_text(json.dumps(r));rows.append(r['summary'])
        (self.pilot/'execution-summary.json').write_text(json.dumps({'implementationCommit':'a'*40,'results':rows}))
    def test_known_denominator_unknown_call_tokens(self):
        d=summary.summarize(self.pilot);self.assertEqual(d['metrics']['plannedLogicalTurns'],27);self.assertEqual(d['metrics']['completedAssistTaskMedianMs'],200);self.assertIsNone(d['rows'][0]['inputTokens']);self.assertIsNone(d['usageForCompletedGenerationCalls']['byMetric']['billedUsd']['completeTotal'])
    def test_missing_or_duplicate_turn_rejected(self):
        p=self.pilot/'execution-summary.json';d=json.loads(p.read_text());d['results'].pop();p.write_text(json.dumps(d))
        with self.assertRaises(ValueError):summary.summarize(self.pilot)
    def test_summary_receipt_drift_rejected(self):
        f=self.pilot/'M-D-1.json';d=json.loads(f.read_text());d['summary']['elapsedMs']=99;f.write_text(json.dumps(d))
        with self.assertRaises(ValueError):summary.summarize(self.pilot)
    def test_call_count_conflict_rejected(self):
        f=self.pilot/'M-D-1.json';d=json.loads(f.read_text());d['calls']=[{'usage':{}}];f.write_text(json.dumps(d))
        with self.assertRaises(ValueError):summary.summarize(self.pilot)
if __name__=='__main__':unittest.main()
