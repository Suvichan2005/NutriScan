"""Synthetic metadata-only split leakage tests; no human/image truth."""
import unittest
from prepare_benchmark import family_brand_blocks

class SplitBlocking(unittest.TestCase):
    def product(self,i,brands,family=None):return {'productGroupId':i,'brands':brands,'familyGroupId':family or i}
    def test_shared_secondary_brand_cannot_cross_blocks(self):
        groups=family_brand_blocks([self.product('a',['A','ITC']),self.product('b',['ITC','B']),self.product('c',['C'])])
        self.assertEqual(len(groups),2);self.assertIn({'a','b'},[{p['productGroupId']for p in g}for g in groups.values()])
    def test_transitive_aliases_and_family_links(self):
        groups=family_brand_blocks([self.product('a',['A','B']),self.product('b',['b','C']),self.product('c',['D'],'shared'),self.product('d',['c'],'shared')]);self.assertEqual(len(groups),1)
    def test_order_and_missing_brand_are_deterministic(self):
        a=self.product('a',['ITC','Sunfeast']);b=self.product('b','sunfeast, itc');c=self.product('c',[],family='standalone')
        self.assertEqual(set(family_brand_blocks([a,b,c])),set(family_brand_blocks([c,b,a])))
if __name__=='__main__':unittest.main()
