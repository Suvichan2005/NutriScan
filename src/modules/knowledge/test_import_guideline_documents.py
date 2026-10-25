import unittest,tempfile,sqlite3
from pathlib import Path
from unittest.mock import patch
from contextlib import closing
from import_guideline_documents import build,extract
class ImportTest(unittest.TestCase):
 def test_roundtrip_index_and_atomic_update(self):
  manifest={'license':'Developer fixture','declaredScope':'Synthetic text pages','sources':[{'id':'example','sha256':'fixture'}]}
  with tempfile.TemporaryDirectory(prefix='nutriscan-guideline-test-')as directory:
   target=Path(directory)/'fixture.sqlite'
   with patch('import_guideline_documents.extract',return_value=['A < 2 g/day.','', 'Population-specific context.']):
    self.assertEqual(build(manifest,Path(directory),target)['pages'],3);self.assertTrue(build(manifest,Path(directory),target,True)['verified'])
   with patch('import_guideline_documents.extract',side_effect=ValueError('changed source')):
    with self.assertRaises(ValueError):build(manifest,Path(directory),target)
   with closing(sqlite3.connect(target))as db:
    self.assertEqual(db.execute('SELECT COUNT(*) FROM pages').fetchone()[0],3);db.execute("UPDATE page_fts SET text='corrupt' WHERE page=1");db.commit()
   with patch('import_guideline_documents.extract',return_value=['A < 2 g/day.','', 'Population-specific context.']):
    with self.assertRaisesRegex(ValueError,'FTS/source page mismatch'):build(manifest,Path(directory),target,True)
 def test_hash_change_stops_before_pdf_parse(self):
  with tempfile.TemporaryDirectory(prefix='nutriscan-guideline-hash-')as directory:
   p=Path(directory)/'source.pdf';p.write_bytes(b'not a real PDF')
   with self.assertRaisesRegex(ValueError,'hash mismatch'):extract({'filename':'source.pdf','sha256':'incorrect','id':'developer'},Path(directory))
if __name__=='__main__':unittest.main()
