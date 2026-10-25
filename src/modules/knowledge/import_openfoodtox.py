"""Build a local-only search index from EFSA OpenFoodTox 3.0.

The source workbook and generated index must remain under .data/. The source
is CC BY-ND 4.0; this importer is for local internal retrieval, not for
redistributing an altered or extracted copy of the dataset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import openpyxl

SOURCE_BYTES = 22_595_502
SOURCE_SHA256 = "5181661e921651d4087b544981e1e5a63b99532844eac0112732806a00a85eda"
SOURCE_MD5 = "445fc05a6a421634df822d14131a7d83"
SOURCE_DOI = "https://doi.org/10.5281/zenodo.19388272"
SOURCE_FILE_URL = "https://zenodo.org/api/records/19388272/files/OFT3.0%20export%20repository.xlsx/content"
SOURCE_LICENSE = "CC BY-ND 4.0"
SOURCE_LICENSE_URL = "https://creativecommons.org/licenses/by-nd/4.0/"
RELEASE_DATE = "2026-04-30"
SOURCE_NAME = "OpenFoodTox 3.0: EFSA's chemical hazards database"


def build_full_store(workbook: openpyxl.Workbook, output_path: Path) -> dict[str, Any]:
    """Preserve every nonempty source cell, row and declared UUID relationship.

    Sparse column/value pairs retain unnamed/duplicate columns without turning
    flattened workbook rows into falsely independent studies or assessments.
    This local store complements the small identity index; it is not shipped.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    if temporary.exists():
        raise ValueError(f"An unfinished import already exists; inspect it before retrying: {temporary}")
    references: dict[tuple[str, str], str] = {}
    for row in rows(workbook, "DATA_DICTIONARY"):
        if row.get("Referenced IUCLID document"):
            table = str(row.get("Table name") or "").split(" (", 1)[0]
            references[(table, str(row.get("Field name") or ""))] = str(row["Referenced IUCLID document"])
    uuid = re.compile(r"\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b")
    statistics: dict[str, Any] = {"sheets": [], "sourceSha256": SOURCE_SHA256, "schemaVersion": 1}
    with closing(sqlite3.connect(temporary)) as db, db:
        db.executescript("""
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE sheets(name TEXT PRIMARY KEY,headers_json TEXT NOT NULL,source_rows INTEGER NOT NULL,imported_rows INTEGER NOT NULL,blank_rows INTEGER NOT NULL,nonempty_cells INTEGER NOT NULL);
          CREATE TABLE records(sheet TEXT NOT NULL,source_row INTEGER NOT NULL,document_id TEXT,parent_id TEXT,endpoint TEXT,cells_json TEXT NOT NULL,PRIMARY KEY(sheet,source_row)) WITHOUT ROWID;
          CREATE TABLE links(sheet TEXT NOT NULL,source_row INTEGER NOT NULL,field TEXT NOT NULL,target_id TEXT NOT NULL,target_type TEXT NOT NULL,PRIMARY KEY(sheet,source_row,field,target_id)) WITHOUT ROWID;
        """)
        for sheet in workbook:
            iterator = sheet.iter_rows(values_only=True)
            headers = list(next(iterator))
            imported = blank = cell_count = 0
            for ordinal, raw in enumerate(iterator, 2):
                cells = [[i, safe_value(value)] for i, value in enumerate(raw) if value is not None and value != ""]
                if not cells:
                    blank += 1
                    continue
                values = {str(headers[i]): value for i, value in cells if headers[i] is not None}
                document_id = values.get("Document UUID")
                parent_id = values.get("Parent UUID")
                db.execute("INSERT INTO records VALUES(?,?,?,?,?,?)", (sheet.title, ordinal, document_id, parent_id, values.get("AdministrativeData.Endpoint"), json.dumps(cells, ensure_ascii=False, separators=(",", ":"))))
                for field, value in values.items():
                    target_type = references.get((sheet.title, field))
                    if sheet.title == "DOSSIER_DOCS" and field in ("DOSSIER UUID", "DOCUMENT UUID"):
                        target_type = "DOSSIER" if field == "DOSSIER UUID" else str(values.get("DOCUMENT TYPE") or "DOCUMENT")
                    if target_type:
                        for target in set(uuid.findall(str(value))):
                            db.execute("INSERT INTO links VALUES(?,?,?,?,?)", (sheet.title, ordinal, field, target.lower(), target_type))
                imported += 1
                cell_count += len(cells)
            if imported + blank != sheet.max_row - 1:
                raise ValueError(f"Source row accounting failed for {sheet.title}")
            db.execute("INSERT INTO sheets VALUES(?,?,?,?,?,?)", (sheet.title, json.dumps(headers), sheet.max_row - 1, imported, blank, cell_count))
            distinct = db.execute("SELECT COUNT(DISTINCT document_id) FROM records WHERE sheet=?", (sheet.title,)).fetchone()[0]
            statistics["sheets"].append({"name": sheet.title, "sourceRows": sheet.max_row - 1, "importedRows": imported, "blankRows": blank, "nonemptyCells": cell_count, "distinctDocumentIds": distinct, "columns": len(headers)})
        db.executescript("CREATE INDEX records_document ON records(document_id); CREATE INDEX records_parent_sheet ON records(parent_id,sheet,source_row); CREATE INDEX links_target ON links(target_id); CREATE INDEX links_source ON links(sheet,source_row);")
        statistics["records"] = db.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        statistics["links"] = db.execute("SELECT COUNT(*) FROM links").fetchone()[0]
        statistics["distinctStudyDocuments"] = db.execute("SELECT COUNT(DISTINCT document_id) FROM records WHERE sheet LIKE 'END_STUDY_REC.%'").fetchone()[0]
        statistics["distinctReferenceValueDocuments"] = db.execute("SELECT COUNT(DISTINCT document_id) FROM records WHERE sheet='FLEX_SUM.ToxRefValues'").fetchone()[0]
        db.execute("INSERT INTO metadata VALUES('manifest',?)", (json.dumps(statistics),))
        db.execute("INSERT INTO metadata VALUES('source',?)", (json.dumps({"name": SOURCE_NAME, "version": "3.0", "releaseDate": RELEASE_DATE, "url": SOURCE_DOI, "sha256": SOURCE_SHA256, "license": SOURCE_LICENSE, "useNotice": "Local internal research only; extracted store is not redistributed. Original EFSA scientific outputs take precedence."}),))
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed.")
    temporary.replace(output_path)
    manifest_path = output_path.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(statistics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return statistics

ADI_PREFIX = "HumanHealthHazardCharacteristics.AcceptableDailyIntake."
ARFD_PREFIX = "HumanHealthHazardCharacteristics.AcuteReferenceDose."


def safe_value(value: Any) -> Any:
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def pick(row: dict[str, Any], prefix: str, fields: Iterable[str]) -> dict[str, Any] | None:
    result = {field: safe_value(row.get(prefix + field)) for field in fields}
    result = {key: value for key, value in result.items() if value is not None and value != ""}
    return result or None


def rows(workbook: openpyxl.Workbook, sheet_name: str):
    sheet = workbook[sheet_name]
    iterator = sheet.iter_rows(values_only=True)
    header_row = next(iterator)
    headers = [str(value or "") for value in header_row[1:]]
    for raw in iterator:
        yield {header: value for header, value in zip(headers, raw[1:])}


def compact_unique(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        key = " ".join(text.casefold().split())
        if text and key not in seen:
            result.append(text[:300])
            seen.add(key)
    return result


def verify_source(path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"Source workbook not found: {path}\nDownload only the pinned EFSA release from {SOURCE_FILE_URL}")
    if path.stat().st_size != SOURCE_BYTES:
        raise SystemExit("Source workbook size does not match the pinned EFSA OpenFoodTox 3.0 release.")
    digest = hashlib.sha256()
    md5 = hashlib.md5()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
            md5.update(block)
    if digest.hexdigest() != SOURCE_SHA256 or md5.hexdigest() != SOURCE_MD5:
        raise SystemExit("Source workbook checksum does not match the pinned EFSA OpenFoodTox 3.0 release.")


def main() -> None:
    if openpyxl.__version__ != "3.1.2":
        raise SystemExit(f"Install the pinned workbook reader with: python -m pip install -r {Path(__file__).with_name('requirements-openfoodtox.txt')}")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Pinned EFSA xlsx file (defaults to .data/sources/openfoodtox/)")
    parser.add_argument("--output", type=Path, help="Local generated index (must remain under .data/)")
    parser.add_argument("--records-output", type=Path, help="Full local workbook store (defaults to .data/knowledge/openfoodtox-3.0.sqlite)")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[3]
    source_path = (args.source or repo / ".data/sources/openfoodtox/OFT3.0-export-repository.xlsx").resolve()
    output_path = (args.output or repo / ".data/knowledge/openfoodtox-3.0.json").resolve()
    records_path = (args.records_output or repo / ".data/knowledge/openfoodtox-3.0.sqlite").resolve()
    data_root = (repo / ".data").resolve()
    if data_root not in source_path.parents or data_root not in output_path.parents or data_root not in records_path.parents:
        raise SystemExit("The source workbook and generated index must remain under the ignored .data/ directory.")
    verify_source(source_path)

    workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
    dossier_rows = {str(row.get("Document UUID")): row for row in rows(workbook, "DOSSIER") if row.get("Document UUID")}
    ref_rows = {str(row.get("Document UUID")): row for row in rows(workbook, "REF_SUB") if row.get("Document UUID")}
    dossier_ids_by_substance: dict[str, list[str]] = {}
    for row in rows(workbook, "DOSSIER_DOCS"):
        if row.get("DOCUMENT TYPE") == "SUBSTANCE" and row.get("DOCUMENT UUID") and row.get("DOSSIER UUID"):
            dossier_ids_by_substance.setdefault(str(row["DOCUMENT UUID"]), []).append(str(row["DOSSIER UUID"]))

    substances: dict[str, dict[str, Any]] = {}
    for row in rows(workbook, "SUB"):
        substance_id = str(row.get("Document UUID") or "")
        chemical_name = str(row.get("ChemicalName") or "").strip()
        if not substance_id or not chemical_name:
            continue
        ref_id = str(row.get("ReferenceSubstance.ReferenceSubstance") or "")
        ref = ref_rows.get(ref_id, {})
        identifiers = {
            "casNumber": safe_value(ref.get("Inventory.CASNumber")),
            "ecNumber": safe_value(ref.get("EC number")),
            "pubchemCid": safe_value(ref.get("PUBCHEM CID")),
            "molecularFormula": safe_value(ref.get("MolecularStructuralInfo.MolecularFormula")),
            "iupacName": safe_value(ref.get("IupacName")),
        }
        identifiers = {key: value for key, value in identifiers.items() if value not in (None, "")}
        aliases = compact_unique([
            chemical_name,
            ref.get("ReferenceSubstanceName"),
            ref.get("Name"),
            ref.get("PARAM NAME"),
            ref.get("CAS name"),
            ref.get("COM NAME [EFSA OFT2.0]"),
            ref.get("SUB NAME [EFSA OFT2.0]"),
            ref.get("Trade name"),
        ])
        substances[substance_id] = {
            "substanceId": substance_id,
            "name": chemical_name,
            "referenceSubstanceId": ref_id or None,
            "aliases": aliases,
            "identifiers": identifiers,
            "type": compact_unique([row.get("TypeOfSubstance.Composition"), row.get("TypeOfSubstance.Origin")]),
            "references": [],
            "assessments": [],
        }

    for substance_id, dossier_ids in dossier_ids_by_substance.items():
        substance = substances.get(substance_id)
        if not substance:
            continue
        seen_dossiers: set[str] = set()
        for dossier_id in dossier_ids:
            if dossier_id in seen_dossiers:
                continue
            seen_dossiers.add(dossier_id)
            dossier = dossier_rows.get(dossier_id)
            if not dossier:
                continue
            title = dossier.get("LiteratureReference.EFSAOutputTitle") or dossier.get("DossierTemplate.NameGivenByUser")
            persistent_id = str(dossier.get("LiteratureReference.LinkToPersistentIdentifier") or "").strip()
            publication_date = dossier.get("LiteratureReference.DateOfEvaluation")
            if publication_date is None:
                remark = str(dossier.get("DossierSubject.DossierSubmissionRemark") or "")
                marker = "Publication date:"
                if marker in remark:
                    publication_date = remark.split(marker, 1)[1].split(";", 1)[0].strip()
            reference = {
                "dossierId": dossier_id,
                "title": str(title).strip()[:500] if title else None,
                "date": safe_value(publication_date),
                "persistentId": persistent_id[:300] or None,
                "foodDomain": safe_value(dossier.get("Domain.FoodDomain")),
                "expertGroup": safe_value(dossier.get("Domain.ExpertGroup")),
                "regulation": safe_value(dossier.get("Domain.Regulation")),
            }
            if any(reference[key] for key in ("title", "persistentId", "foodDomain")):
                substance["references"].append(reference)
        substance["references"] = substance["references"][:12]

    assessment_count = 0
    adi_count = 0
    arfd_count = 0
    assessment_fields = {
        "adi": (ADI_PREFIX, ["Adi.lowerQualifier", "Adi.lowerValue", "Adi.Unit", "Adi.upperQualifier", "Adi.upperValue", "AssessmentBody", "AssessmentBody.Other", "CriticalEndpoint", "Justification", "JustificationAndComments", "JustificationOverallUf", "NoAllocated", "OverallUncertainty", "Population", "Population.Remarks"]),
        "acuteReferenceDose": (ARFD_PREFIX, ["Arfd.lowerQualifier", "Arfd.lowerValue", "Arfd.Unit", "Arfd.upperQualifier", "Arfd.upperValue", "AssessmentBody", "AssessmentBody.Other", "CriticalEndpoint", "Justification", "JustificationAndComments", "JustificationOverallUf", "NoAllocated", "OverallUncertainty", "Population"]),
    }
    for row in rows(workbook, "FLEX_SUM.ToxRefValues"):
        substance_id = str(row.get("Parent UUID") or "")
        substance = substances.get(substance_id)
        if not substance:
            continue
        values = {name: pick(row, prefix, fields) for name, (prefix, fields) in assessment_fields.items()}
        if not any(values.values()):
            continue
        substance["assessments"].append({
            "assessmentId": str(row.get("Document UUID") or ""),
            "adi": values["adi"],
            "acuteReferenceDose": values["acuteReferenceDose"],
        })
        assessment_count += 1
        adi_count += int(values["adi"] is not None)
        arfd_count += int(values["acuteReferenceDose"] is not None)

    full_store = build_full_store(workbook, records_path)
    workbook.close()
    payload = {
        "schemaVersion": 1,
        "dataset": {
            "name": SOURCE_NAME,
            "version": "3.0",
            "releaseDate": RELEASE_DATE,
            "sourceUrl": SOURCE_DOI,
            "fileUrl": SOURCE_FILE_URL,
            "sourceSha256": SOURCE_SHA256,
            "sourceBytes": SOURCE_BYTES,
            "license": SOURCE_LICENSE,
            "licenseUrl": SOURCE_LICENSE_URL,
            "attribution": "European Food Safety Authority (EFSA), OpenFoodTox 3.0.",
            "useNotice": "Local research/runtime index only. Do not redistribute this derived extraction; the source license is CC BY-ND 4.0.",
        },
        "statistics": {
            "substances": len(substances),
            "substancesWithAssessmentReferences": sum(bool(item["references"]) for item in substances.values()),
            "substancesWithReferenceValues": sum(bool(item["assessments"]) for item in substances.values()),
            "assessmentRowsWithAdiOrAcuteReferenceDose": assessment_count,
            "assessmentRowsWithAdi": adi_count,
            "assessmentRowsWithAcuteReferenceDose": arfd_count,
        },
        "substances": list(substances.values()),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(output_path)
    print(json.dumps({"output": str(output_path), "bytes": output_path.stat().st_size, "dataset": payload["statistics"], "fullStore": {"path": str(records_path), "bytes": records_path.stat().st_size, **full_store}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
