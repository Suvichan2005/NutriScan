import copy,unittest
import benchmark_metrics as m

class SupplementaryMetrics(unittest.TestCase):
    """Synthetic structural tests only; these are not package/model results."""
    def test_unicode_ocr_edits_and_zero_denominator(self):
        self.assertEqual(m.text_errors('Protein 5 g','Protein 8 g')['wordEdits'],1)
        self.assertIsNone(m.text_errors('','invented')['CER'])
        self.assertEqual(m.text_errors('हिन्दी','हिन्दी')['CER'],0)
    def test_duplicate_text_is_false_positive(self):
        x={'category':'allergens','status':'clear','literalText':'Contains milk','order':0}
        r=m.text_items([x],[x,x],3);self.assertEqual(r['precision'],.5);self.assertEqual(r['claimScope'],'candidate-reference-agreement')
    def test_contains_not_may_contain(self):
        a={'category':'allergens','status':'clear','literalText':'Contains milk'}
        b={**a,'category':'precautions','literalText':'May contain milk'}
        self.assertEqual(m.text_items([a],[b],1)['exactMatches'],0)
    def test_ingredient_order_and_percent(self):
        a={'category':'ingredients','status':'clear','literalText':'Wheat','order':0,'printedQuantityOrCode':'80%'};b={**a,'literalText':'Oil','order':1,'printedQuantityOrCode':None}
        self.assertFalse(m.text_items([a,b],[{**b,'order':0},{**a,'order':1}],2)['ingredientSequenceExact'])
        self.assertEqual(m.text_items([a],[{**a,'printedQuantityOrCode':'8%'}],2)['exactMatches'],0)
    def test_unreadable_not_zero(self):
        a={'category':'claims','status':'ambiguous','literalText':None}
        self.assertIsNone(m.text_items([a],[],3)['recall'])
    def test_retrieval_uses_existing_unknown_gates(self):
        r=m.retrieval([{'queryId':'q','judgments':{},'rankedIds':['s'],'judgmentStatus':'pending','poolComplete':False}]);self.assertIsNone(r['perQuery'][0]['ndcg']);self.assertEqual(r['perQuery'][0]['unjudgedIds'],['s'])
    def test_retrieval_negative_and_bad_grades(self):
        r=m.retrieval([{'queryId':'q','judgments':{'s':0},'rankedIds':['s'],'judgmentStatus':'independent-human','poolComplete':True}]);self.assertTrue(r['perQuery'][0]['negativeFalseMatch'])
        with self.assertRaises(ValueError):m.retrieval([{'queryId':'q','judgments':{'s':True},'rankedIds':[]}])
    def test_state_must_match_basis_and_qualifier(self):
        actual={'calculation':{'value':.067,'unit':'g','qualifier':'<','basis':'selected-portion'}}
        checks=[{'id':'value','path':'/calculation/value','op':'numeric-close','expected':.067,'absoluteTolerance':.0001},{'id':'basis','path':'/calculation/basis','op':'equals','expected':'per-100g'},{'id':'qualifier','path':'/calculation/qualifier','op':'equals','expected':'='}]
        self.assertEqual(m.state_assertions(actual,checks)['passed'],1)
    def test_state_does_not_mandate_tool_sequence(self):
        checks=[{'id':'correction','path':'/activeRevision','op':'equals','expected':2}]
        for plan in [[],['calculator'],['lookup','calculator']]:self.assertEqual(m.state_assertions({'activeRevision':2,'toolPlan':plan},checks)['passRate'],1)
    def test_missing_state_not_success(self):
        self.assertFalse(m.state_assertions({},[{'id':'x','path':'/x','op':'equals','expected':None}])['assertions'][0]['passed'])
        with self.assertRaises(ValueError):m.state_assertions({'x':True},[{'id':'x','path':'/x','op':'numeric-close','expected':1}])
    def test_atomic_wrong_source_or_quote_rejected(self):
        c={'id':'c','span':'Milk','kind':'package','verdict':'supported','evidenceIds':['s'],'reason':'Printed declaration'}
        with self.assertRaises(ValueError):m.atomic_support('Milk',[c],[], 'synthetic')
        with self.assertRaises(ValueError):m.atomic_support('No declaration',[c],['s'],'synthetic')
        self.assertEqual(m.atomic_support('Milk',[c],['s'],'AI-assisted')['assessorType'],'AI-assisted')
        self.assertIsNone(m.atomic_support('',[],[],'synthetic')['supportedFraction'])
    def test_grits_identical_and_wrong_cell_association(self):
        cells=[{'row_nums':[0],'column_nums':[0],'cell_text':'Protein','bbox':[0,0,10,10]},{'row_nums':[0],'column_nums':[1],'cell_text':'5 g','bbox':[10,0,20,10]}]
        r=m.grits(cells,cells);self.assertAlmostEqual(r['content'][0],1);self.assertAlmostEqual(r['topology'][0],1);self.assertAlmostEqual(r['location'][0],1)
        wrong=copy.deepcopy(cells);wrong[0]['cell_text']='5 g';wrong[1]['cell_text']='Protein';self.assertLess(m.grits(cells,wrong)['content'][0],1)
    def test_grits_missing_or_fabricated_grid(self):
        self.assertEqual(m.grits([],[])['status'],'UNSCORABLE')
        with self.assertRaises(ValueError):m.grits([{'row_nums':[0],'column_nums':[1],'cell_text':'gap'}],[{'row_nums':[0],'column_nums':[0],'cell_text':'x'}])
        x={'row_nums':[0],'column_nums':[0],'cell_text':'x'}
        with self.assertRaises(ValueError):m.grits([x,x],[x])
        self.assertIsNone(m.grits([x],[x])['location'])
if __name__=='__main__':unittest.main()
