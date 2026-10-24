#!/usr/bin/env python3
"""Build the compact, attribution-preserving FoodOn ingredient index.

Inputs are the checksum-pinned official release files kept under .data/.
The generated public extract contains FoodOn classes, English labels and
synonyms, and FoodOn parent links only; it does not copy imported ontologies.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
OWL_PATH = ROOT / ".data/knowledge/foodon.owl"
SYNONYMS_PATH = ROOT / ".data/knowledge/foodon-synonyms.tsv"
OUTPUT_PATH = ROOT / "data/foodon-index.json"

OWL_SHA256 = "b897bf64c1b265c422db9ee01e1235c10c0b809e7f02326ef810a52068347edf"
SYNONYMS_SHA256 = "1900fb2c80d834287cfdd0b52a98957b18269e86c197617711bc3a5d8541deb2"
REPOSITORY_COMMIT = "cd73540243a84bcd511a500d9a497d12d7dc02f6"
EXPECTED_VERSION = "2026-09-20"
OWL_URL = f"https://raw.githubusercontent.com/FoodOntology/foodon/{REPOSITORY_COMMIT}/foodon.owl"
SYNONYMS_URL = f"https://raw.githubusercontent.com/FoodOntology/foodon/{REPOSITORY_COMMIT}/foodon-synonyms.tsv"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"

RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
OWL = "{http://www.w3.org/2002/07/owl#}"
FOODON_IRI_PREFIX = "http://purl.obolibrary.org/obo/FOODON_"
FOODON_ID = re.compile(r"^FOODON_[0-9]{8}$")
ENGLISH_SUFFIX = re.compile(r"@en$", re.IGNORECASE)
LANGUAGE_SUFFIX = re.compile(r"@[a-z][a-z0-9-]*$", re.IGNORECASE)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_hash(path: Path, expected: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Required source file is missing: {path}")
    actual = sha256(path)
    if actual != expected:
        raise ValueError(f"Source checksum mismatch for {path.name}: expected {expected}, got {actual}")


def source_version_and_deprecated(path: Path) -> tuple[str, set[str]]:
    version_iri = ""
    deprecated: set[str] = set()
    for _, element in ET.iterparse(path, events=("end",)):
        if element.tag == OWL + "Ontology":
            version = element.find(OWL + "versionIRI")
            if version is not None:
                version_iri = version.get(RDF + "resource", "")
        elif element.tag == OWL + "Class":
            iri = element.get(RDF + "about", "")
            if iri.startswith(FOODON_IRI_PREFIX):
                identifier = iri.rsplit("/", 1)[-1]
                if any((item.text or "").strip().lower() == "true" for item in element.findall(OWL + "deprecated")):
                    deprecated.add(identifier)
            element.clear()
    if f"/releases/{EXPECTED_VERSION}/foodon.owl" not in version_iri:
        raise ValueError(f"Unexpected FoodOn release IRI: {version_iri or 'missing'}")
    return version_iri, deprecated


def english_literal(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    if LANGUAGE_SUFFIX.search(value) and not ENGLISH_SUFFIX.search(value):
        return None
    value = ENGLISH_SUFFIX.sub("", value).strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1]
    value = value.replace('\\"', '"').replace("\\\\", "\\")
    value = re.sub(r"\s+", " ", value).strip()
    return value[:180] or None


def build() -> dict:
    require_hash(OWL_PATH, OWL_SHA256)
    require_hash(SYNONYMS_PATH, SYNONYMS_SHA256)
    version_iri, deprecated = source_version_and_deprecated(OWL_PATH)
    records: dict[str, dict] = {}

    with SYNONYMS_PATH.open("r", encoding="utf-8", newline="") as handle:
        rows = csv.reader(handle, delimiter="\t")
        header = next(rows, None)
        if header != ["?class", "?parent", "?type", "?label"]:
            raise ValueError("Unexpected FoodOn synonym export header.")
        for row in rows:
            if len(row) < 4:
                continue
            match = re.search(r"FOODON_[0-9]{8}", row[0])
            if not match:
                continue
            identifier = match.group(0)
            if identifier in deprecated:
                continue
            record = records.setdefault(identifier, {"id": identifier, "label": "", "aliases": [], "parents": set()})
            parent_match = re.search(r"FOODON_[0-9]{8}", row[1])
            if parent_match and parent_match.group(0) not in deprecated:
                record["parents"].add(parent_match.group(0))

            kind = row[2].strip()
            literal = english_literal(row[3])
            if not literal:
                continue
            if kind == "label" and not record["label"]:
                record["label"] = literal
            elif kind in {"synonym", "synonym (exact)", "synonym (narrow)", "synonym (broad)", "label (alternative)"}:
                normalized_kind = {
                    "synonym (exact)": "exact",
                    "synonym": "synonym",
                    "synonym (narrow)": "narrow",
                    "synonym (broad)": "broad",
                    "label (alternative)": "alternative-label",
                }[kind]
                record["aliases"].append({"text": literal, "kind": normalized_kind})

    terms = []
    for identifier, record in sorted(records.items()):
        label = record["label"]
        if not label:
            continue
        seen = {label.casefold()}
        aliases = []
        for alias in sorted(record["aliases"], key=lambda item: (item["kind"], item["text"].casefold())):
            key = alias["text"].casefold()
            if key in seen:
                continue
            seen.add(key)
            aliases.append(alias)
            if len(aliases) == 24:
                break
        terms.append({
            "id": identifier,
            "label": label,
            "aliases": aliases,
            "parents": sorted(parent for parent in record["parents"] if parent in records and records[parent]["label"]),
        })

    if len(terms) < 20_000:
        raise ValueError(f"Only {len(terms)} active, labeled FoodOn terms were extracted; refusing to publish a partial index.")
    return {
        "schemaVersion": 1,
        "source": {
            "name": "FoodOn Food Ontology",
            "version": EXPECTED_VERSION,
            "versionIri": version_iri,
            "repositoryCommit": REPOSITORY_COMMIT,
            "ontologyUrl": OWL_URL,
            "synonymExportUrl": SYNONYMS_URL,
            "license": "CC BY 4.0",
            "licenseUrl": LICENSE_URL,
            "ontologySha256": OWL_SHA256,
            "synonymExportSha256": SYNONYMS_SHA256,
        },
        "terms": terms,
    }


def main() -> int:
    try:
        index = build()
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n"
        OUTPUT_PATH.write_text(payload, encoding="utf-8", newline="\n")
        print(f"FoodOn {EXPECTED_VERSION}: {len(index['terms'])} active labeled terms; {OUTPUT_PATH.stat().st_size} bytes")
        return 0
    except (OSError, ValueError, ET.ParseError) as error:
        print(f"FoodOn import failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
