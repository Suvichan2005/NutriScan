import unittest
from import_codex_categories import import_categories
class ImportTest(unittest.TestCase):
 def test_hierarchy_and_raw_attributes(self):
  html=b'<li class="category-item" data-category-code="07.0" data-category-id="00000000-0000-0000-0000-000000000001" data-in-table3="0"><span class="category-label">Bakery &amp; mixes</span><ul><li class="category-item" data-category-code="07.1" data-category-id="00000000-0000-0000-0000-000000000002" data-in-table3="1"><span class="category-label">Bread</span></li></ul></li>'
  r=import_categories(html,'2026-10-25');self.assertEqual(r['accounting'],{'categoryCount':2,'parentEdges':1,'uniqueCodes':2});self.assertEqual(r['categories'][0]['label'],'Bakery & mixes');self.assertEqual(r['categories'][1]['parentCode'],'07.0');self.assertEqual(r['categories'][1]['sourceTable3Attribute'],'1')
  with self.assertRaises(ValueError):import_categories(html+html,'2026-10-25')
  with self.assertRaises(ValueError):import_categories(b'<html>unavailable</html>','2026-10-25')
if __name__=='__main__':unittest.main()
