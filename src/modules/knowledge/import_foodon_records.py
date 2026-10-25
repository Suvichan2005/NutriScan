"""Preserve named FoodOn class properties and their reified axiom annotations.

No OWL inference or imported-ontology expansion. The original OWL stays private.
"""
import argparse
import hashlib
import json
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
import import_foodon as taxonomy

RDF, OWL = taxonomy.RDF, taxonomy.OWL
RDFS = '{http://www.w3.org/2000/01/rdf-schema#}'


def identifier(iri):
    value = iri.removeprefix(taxonomy.FOODON_IRI_PREFIX)
    return 'FOODON_' + value if iri.startswith(taxonomy.FOODON_IRI_PREFIX) and value.isdigit() and len(value) == 8 else None


def structure(element):
    return {'predicate': element.tag, 'attributes': dict(element.attrib),
            'text': element.text, 'tail': element.tail,
            'children': [structure(child) for child in element]}


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def source_records(source):
    depth = 0
    for event, element in ET.iterparse(source, events=('start', 'end')):
        if event == 'start':
            depth += 1
            continue
        if depth == 2:
            if element.tag == OWL + 'Class':
                concept_id = identifier(element.get(RDF + 'about', ''))
                if concept_id:
                    yield concept_id, 'class', element
            elif element.tag == OWL + 'Axiom':
                annotated = element.find(OWL + 'annotatedSource')
                concept_id = identifier(annotated.get(RDF + 'resource', '')) if annotated is not None else None
                if concept_id:
                    yield concept_id, 'axiom', element
            element.clear()
        depth -= 1


def build(source, target, verify=False, expected_hash=taxonomy.OWL_SHA256):
    taxonomy.require_hash(source, expected_hash)
    target.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(f'{target.resolve().as_uri()}?mode=ro', uri=True) if verify else sqlite3.connect(target)
    counts = {'classes': 0, 'axioms': 0, 'fields': 0, 'definitions': 0, 'restrictions': 0, 'deprecatedClasses': 0}
    offsets, declared = {}, set()
    try:
        if not verify:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables - {'metadata', 'concepts', 'fields'}:
                raise ValueError('Unexpected existing database; preserved')
            db.executescript('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS concepts(id TEXT PRIMARY KEY,label TEXT,deprecated INTEGER,xml TEXT,xml_hash TEXT); CREATE TABLE IF NOT EXISTS fields(concept_id TEXT,ordinal INTEGER,kind TEXT,predicate TEXT,payload TEXT,payload_hash TEXT,PRIMARY KEY(concept_id,ordinal));')
            previous = db.execute("SELECT value FROM metadata WHERE key='sourceHash'").fetchone()
            if previous and previous[0] != expected_hash:
                raise ValueError('Existing source differs; preserved')
        with db:
            if not verify:
                db.execute('DELETE FROM fields')
                db.execute('DELETE FROM concepts')
            for concept_id, kind, element in source_records(source):
                if kind == 'class':
                    if concept_id in declared:
                        raise ValueError('Duplicate class declaration: ' + concept_id)
                    declared.add(concept_id)
                    labels = element.findall(RDFS + 'label')
                    label = next((item.text for item in labels if item.get('{http://www.w3.org/XML/1998/namespace}lang') in (None, 'en')), None)
                    status = element.find(OWL + 'deprecated')
                    deprecated = None if status is None else int((status.text or '').strip().lower() == 'true')
                    xml = ET.tostring(element, encoding='unicode')
                    record = (concept_id, label, deprecated, xml, digest(xml))
                    if verify:
                        if db.execute('SELECT id,label,deprecated,xml,xml_hash FROM concepts WHERE id=?', (concept_id,)).fetchone() != record:
                            raise ValueError('Class source mismatch: ' + concept_id)
                    else:
                        db.execute('INSERT INTO concepts VALUES(?,?,?,?,?)', record)
                    counts['classes'] += 1
                    counts['deprecatedClasses'] += deprecated == 1
                    children = list(element)
                else:
                    counts['axioms'] += 1
                    children = [element]
                for child in children:
                    payload = encode(structure(child))
                    ordinal = offsets.get(concept_id, 0)
                    offsets[concept_id] = ordinal + 1
                    record = (concept_id, ordinal, kind, child.tag, payload, digest(payload))
                    if verify:
                        if db.execute('SELECT concept_id,ordinal,kind,predicate,payload,payload_hash FROM fields WHERE concept_id=? AND ordinal=?', (concept_id, ordinal)).fetchone() != record:
                            raise ValueError('Source property mismatch: ' + concept_id)
                    else:
                        db.execute('INSERT INTO fields VALUES(?,?,?,?,?,?)', record)
                    counts['fields'] += 1
                    counts['definitions'] += kind == 'class' and child.tag == '{http://purl.obolibrary.org/obo/}IAO_0000115'
                    counts['restrictions'] += sum(node.tag == OWL + 'Restriction' for node in child.iter())
            if db.execute('SELECT COUNT(*) FROM concepts').fetchone()[0] != counts['classes'] or db.execute('SELECT COUNT(*) FROM fields').fetchone()[0] != counts['fields']:
                raise ValueError('Record accounting mismatch')
            if not verify:
                db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', ('sourceHash', expected_hash))
                db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', ('schemaVersion', '1'))
                db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)', ('counts', encode(counts)))
            elif db.execute("SELECT value FROM metadata WHERE key='sourceHash'").fetchone() != (expected_hash,):
                raise ValueError('Source metadata mismatch')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Database integrity failure')
        return {'sourceSha256': expected_hash, 'counts': counts, 'verified': verify,
                'scope': 'All named FoodOn class declarations and their original properties/annotated-source axioms, including deprecated declarations. No OWL reasoning or imported-ontology expansion.'}
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=taxonomy.OWL_PATH)
    parser.add_argument('--output', type=Path, default=taxonomy.ROOT / '.data/knowledge/foodon-records.sqlite')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    result = build(args.source, args.output, args.verify)
    if args.verify:
        args.output.with_suffix('.verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
