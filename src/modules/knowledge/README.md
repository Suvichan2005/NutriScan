# NutriScan knowledge module

This module owns NutriScan's curated food-reference corpus, additive identity candidates, claim-wording rules, local lexical/concept retrieval and the server-side local-embedding retrieval implementation.

## Public entries

- `index.ts` is safe to import from browser code. It exposes static source records, additive lookup and tentative identity helpers, claim guidance, and the deterministic local retrieval baseline. It contains no Node, filesystem, network, MiniLM, Gemini, or UI dependencies.
- `server.ts` is the Node.js-only MiniLM/BM25 retrieval entry. It uses the existing shared `EvidenceSource` contract and preserves the repository-root paths `.data/models/` and `data/semantic-index.json`.
- `src/lib/knowledge.ts` and `src/lib/semantic.ts` remain compatibility facades for existing application imports.

Shared schemas remain owner-controlled in `src/lib/contracts.ts`; this module does not define duplicate production contracts. API routes, HTTP policy, external source fetching, application orchestration, and user-facing presentation remain outside the module.

## Data and limits

The bundled records are concise attributed summaries and identity references, not full source publications or verified legal determinations. Each record carries its publisher, source URL, jurisdiction, dates, limitations, and a license note. Unknown redistribution terms are not treated as clearance. Similarity scores are retrieval signals, not probabilities, source quality, entailment, or product facts. Static references do not establish current law. Additive identity matches do not establish package presence, dose, authorization, or individual safety. Fuzzy OCR identity matches are tentative and retain their observed wording.

The Node-only server entry can also query the local EFSA OpenFoodTox 3.0 snapshot at `.data/knowledge/openfoodtox-3.0.json`. The pinned 2026-04-30 release contains 7,880 substance identities, 5,620 with assessment references, 872 with recorded reference values, and 1,263 assessment rows with an ADI or acute reference dose. This is chemical-hazard reference data, not a food-product catalog or evidence of package exposure. The source is CC BY-ND 4.0; keep both the source workbook and derived local snapshot under ignored `.data/` and do not redistribute the extraction.

The Node-only server entry also searches the bundled FoodOn identity index at `data/foodon-index.json`. It contains 25,143 active, English-labeled FoodOn classes from the 2026-09-20 release, including selected labels, synonym kinds, and parent links. The source is CC BY 4.0 with attribution; source hashes, version, repository commit, license, and URLs travel with every result. Import the official OWL and synonym export into ignored `.data/knowledge/foodon.owl` and `.data/knowledge/foodon-synonyms.tsv`, then run `python src/modules/knowledge/import_foodon.py`. The importer rejects unpinned or modified source files and writes a deterministic compact index. Search results are identity candidates only; taxonomy does not establish package presence, ingredient function, health effect, allergen relationship, dose, authorization, or safety. The snapshot is queried locally and does not transmit user text, profile data, or images. FoodOn does not include every Indian-market synonym; for example, the pinned release has no `maida` alias, so that query remains unresolved.

Do not add restricted source text, private package images, health profiles, API keys, or user conversations. Do not use this module to turn missing information into zero, infer a product's contents, or produce a clinical/legal verdict.

## Offline checks and evaluation

Run module-local contract and retrieval tests from the repository root:

```powershell
node src/modules/knowledge/test.mjs
```

No API key, private image, or model download is needed for that suite. Existing retrieval measurements remain available through `npm run embeddings:evaluate` and `npm run embeddings:evaluate:boundary`; they use developer-authored queries, not independent relevance evaluation. These root scripts write evaluation receipts. `npm run embeddings:prepare` is an explicit setup action that may download the pinned model if its local files are absent.

To reproduce the local OpenFoodTox snapshot, install the pinned workbook dependency and place the checksum-verified official export at `.data/sources/openfoodtox/OFT3.0-export-repository.xlsx`, then run:

```powershell
python -m pip install -r src/modules/knowledge/requirements-openfoodtox.txt
python src/modules/knowledge/import_openfoodtox.py
```

The importer verifies the pinned file size and hashes before writing the local-only index. A missing workbook or dependency is an explicit setup condition; application queries do not download or transmit data.

To reproduce the bundled FoodOn index, obtain the two official files at the exact pinned repository commit, then run the importer:

```powershell
New-Item -ItemType Directory -Force .data/knowledge | Out-Null
curl.exe --fail --location --output .data/knowledge/foodon.owl https://raw.githubusercontent.com/FoodOntology/foodon/cd73540243a84bcd511a500d9a497d12d7dc02f6/foodon.owl
curl.exe --fail --location --output .data/knowledge/foodon-synonyms.tsv https://raw.githubusercontent.com/FoodOntology/foodon/cd73540243a84bcd511a500d9a497d12d7dc02f6/foodon-synonyms.tsv
python src/modules/knowledge/import_foodon.py
```

The upstream source files remain in ignored `.data/`; only the compact attributed index is tracked. The importer checks both SHA-256 digests and the ontology release IRI before writing.

## Contribution boundary

Contributor changes belong under `src/modules/knowledge/**`. Shared contracts, `src/lib/` facades, parser/engine integration, root scripts/configuration, API routes, network policy, UI, and cross-module behavior require an owner-authored integration change. A useful change includes offline module tests, source provenance/licensing notes for new records, and independent relevance or abstention labels kept separate from tuning cases.
