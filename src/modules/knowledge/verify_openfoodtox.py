"""Verify every retained workbook cell against the local complete EFSA store."""
import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path
import openpyxl
from import_openfoodtox import verify_source, safe_value
from import_openfoodtox import SOURCE_SHA256


def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root / '.data/sources/openfoodtox/OFT3.0-export-repository.xlsx')
    parser.add_argument('--database', type=Path, default=root / '.data/knowledge/openfoodtox-3.0.sqlite')
    parser.add_argument('--receipt', type=Path, default=root / '.data/knowledge/openfoodtox-3.0.verification.json')
    args = parser.parse_args()
    verify_source(args.source)
    workbook = openpyxl.load_workbook(args.source, read_only=True, data_only=True)
    checked_rows = checked_cells = 0
    with closing(sqlite3.connect(f'{args.database.resolve().as_uri()}?mode=ro', uri=True)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        for sheet in workbook:
            iterator = sheet.iter_rows(values_only=True)
            headers = list(next(iterator))
            saved_headers = json.loads(db.execute('SELECT headers_json FROM sheets WHERE name=?', (sheet.title,)).fetchone()[0])
            assert headers == saved_headers, sheet.title
            count = 0
            for ordinal, raw in enumerate(iterator, 2):
                expected = [[i, safe_value(value)] for i, value in enumerate(raw) if value is not None and value != '']
                saved = db.execute('SELECT cells_json FROM records WHERE sheet=? AND source_row=?', (sheet.title, ordinal)).fetchone()
                if not expected:
                    assert saved is None
                    continue
                assert saved and json.loads(saved[0]) == expected, (sheet.title, ordinal)
                count += 1
                checked_cells += len(expected)
            assert count == db.execute('SELECT COUNT(*) FROM records WHERE sheet=?', (sheet.title,)).fetchone()[0]
            checked_rows += count
    workbook.close()
    receipt = {'status': 'verified', 'sourceSha256': SOURCE_SHA256, 'sheets': len(workbook.sheetnames), 'rows': checked_rows, 'nonemptySourceCells': checked_cells, 'scope': 'Every nonempty cell and complete worksheet header; no scientific interpretation or license-to-redistribute claim.'}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
