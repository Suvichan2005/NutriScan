from contextlib import closing
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from import_foodon_records import build, source_records

XML = '''<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:owl="http://www.w3.org/2002/07/owl#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:obo="http://purl.obolibrary.org/obo/">
<owl:Class rdf:about="http://purl.obolibrary.org/obo/FOODON_00000001"><rdfs:label xml:lang="en">Developer ingredient</rdfs:label><obo:IAO_0000115 xml:lang="en">Original developer definition.</obo:IAO_0000115><rdfs:subClassOf><owl:Restriction><owl:onProperty rdf:resource="http://example.test/property"/><owl:someValuesFrom rdf:resource="http://example.test/foreign-concept"/></owl:Restriction></rdfs:subClassOf></owl:Class>
<owl:Axiom><owl:annotatedSource rdf:resource="http://purl.obolibrary.org/obo/FOODON_00000001"/><owl:annotatedProperty rdf:resource="http://purl.obolibrary.org/obo/IAO_0000115"/><obo:IAO_0000119>Developer attribution</obo:IAO_0000119></owl:Axiom>
<owl:Class rdf:about="http://purl.obolibrary.org/obo/FOODON_00000002"><rdfs:label>Old developer class</rdfs:label><owl:deprecated>true</owl:deprecated></owl:Class>
</rdf:RDF>'''


class FoodOnRecordImportTests(unittest.TestCase):
    def test_preserves_definitions_expressions_axiom_attribution_and_deprecation(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'source.owl', Path(directory) / 'records.sqlite'
            source.write_text(XML, encoding='utf-8')
            sha = hashlib.sha256(source.read_bytes()).hexdigest()
            result = build(source, target, expected_hash=sha)
            self.assertEqual(result['counts'], {'classes': 2, 'axioms': 1, 'fields': 6, 'definitions': 1, 'restrictions': 1, 'deprecatedClasses': 1})
            self.assertTrue(build(source, target, verify=True, expected_hash=sha)['verified'])
            with closing(sqlite3.connect(target)) as db, db:
                rows = db.execute('SELECT payload FROM fields WHERE concept_id=? ORDER BY ordinal', ('FOODON_00000001',)).fetchall()
                payloads = [json.loads(row[0]) for row in rows]
                self.assertEqual(payloads[1]['attributes']['{http://www.w3.org/XML/1998/namespace}lang'], 'en')
                self.assertEqual(payloads[2]['children'][0]['children'][1]['attributes']['{http://www.w3.org/1999/02/22-rdf-syntax-ns#}resource'], 'http://example.test/foreign-concept')
                self.assertEqual(payloads[3]['children'][2]['text'], 'Developer attribution')
                db.execute('UPDATE fields SET payload=? WHERE ordinal=1', ('changed',))
            with self.assertRaisesRegex(ValueError, 'Source property mismatch'):
                build(source, target, verify=True, expected_hash=sha)

    def test_failed_rebuild_rolls_back_and_changed_sources_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'source.owl', Path(directory) / 'records.sqlite'
            source.write_text(XML, encoding='utf-8')
            sha = hashlib.sha256(source.read_bytes()).hexdigest()
            build(source, target, expected_hash=sha)
            def broken(path):
                for record in source_records(path):
                    yield record
                    raise ValueError('Interrupted fixture')
            with patch('import_foodon_records.source_records', broken), self.assertRaisesRegex(ValueError, 'Interrupted'):
                build(source, target, expected_hash=sha)
            self.assertTrue(build(source, target, verify=True, expected_hash=sha)['verified'])
            source.write_text('different source', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                build(source, target, expected_hash=sha)


if __name__ == '__main__':
    unittest.main()
