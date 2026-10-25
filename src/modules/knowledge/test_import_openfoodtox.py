import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
import openpyxl
from import_openfoodtox import build_full_store


class FullWorkbookPreservation(unittest.TestCase):
    def test_retains_all_source_cells_and_declared_relationships(self):
        workbook = openpyxl.Workbook()
        dictionary = workbook.active
        dictionary.title = 'DATA_DICTIONARY'
        dictionary.append([None, 'Table name', 'Field name', 'Referenced IUCLID document'])
        dictionary.append([0, 'STUDY (STUDY)', 'Parent UUID', 'SUBSTANCE'])
        study = workbook.create_sheet('STUDY')
        study.append([None, 'Document UUID', 'Parent UUID', 'Dose', 'Dose', 'Discussion'])
        study.append([0, '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 2, 3, 'x' * 10000])
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'records.sqlite'
            manifest = build_full_store(workbook, output)
            self.assertEqual(manifest['records'], 2)
            self.assertEqual(manifest['links'], 1)
            db = sqlite3.connect(output)
            try:
                cells = json.loads(db.execute("SELECT cells_json FROM records WHERE sheet='STUDY'").fetchone()[0])
                self.assertIn([0, 0], cells)
                self.assertIn([3, 2], cells)
                self.assertIn([4, 3], cells)
                self.assertIn([5, 'x' * 10000], cells)
            finally:
                db.close()
            self.assertTrue(output.exists())  # Windows rename requires the importer connection to be closed.
        workbook.close()


if __name__ == '__main__':
    unittest.main()
