# NutriScan knowledge module

This module owns NutriScan's curated food-reference corpus, additive identity candidates, claim-wording rules, local lexical/concept retrieval and the server-side local-embedding retrieval implementation.

## Public entries

- `index.ts` is safe to import from browser code. It exposes static source records, additive lookup and tentative identity helpers, claim guidance, and the deterministic local retrieval baseline. It contains no Node, filesystem, network, MiniLM, Gemini, or UI dependencies.
- `server.ts` is the Node.js-only MiniLM/BM25 retrieval entry. It uses the existing shared `EvidenceSource` contract and preserves the repository-root paths `.data/models/` and `data/semantic-index.json`.
- `src/lib/knowledge.ts` and `src/lib/semantic.ts` remain compatibility facades for existing application imports.

Shared schemas remain owner-controlled in `src/lib/contracts.ts`; this module does not define duplicate production contracts. API routes, HTTP policy, external source fetching, application orchestration, and user-facing presentation remain outside the module.

## Data and limits

The bundled records are concise attributed summaries and identity references, not full source publications or verified legal determinations. Each record carries its publisher, source URL, jurisdiction, dates, limitations, and a license note. Unknown redistribution terms are not treated as clearance. Similarity scores are retrieval signals, not probabilities, source quality, entailment, or product facts. Static references do not establish current law. Additive identity matches do not establish package presence, dose, authorization, or individual safety. Fuzzy OCR identity matches are tentative and retain their observed wording.

Do not add restricted source text, private package images, health profiles, API keys, or user conversations. Do not use this module to turn missing information into zero, infer a product's contents, or produce a clinical/legal verdict.

## Offline checks and evaluation

Run module-local contract and retrieval tests from the repository root:

```powershell
node src/modules/knowledge/test.mjs
```

No API key, private image, or model download is needed for that suite. Existing retrieval measurements remain available through `npm run embeddings:evaluate` and `npm run embeddings:evaluate:boundary`; they use developer-authored queries, not independent relevance evaluation. These root scripts write evaluation receipts. `npm run embeddings:prepare` is an explicit setup action that may download the pinned model if its local files are absent.

## Contribution boundary

Contributor changes belong under `src/modules/knowledge/**`. Shared contracts, `src/lib/` facades, parser/engine integration, root scripts/configuration, API routes, network policy, UI, and cross-module behavior require an owner-authored integration change. A useful change includes offline module tests, source provenance/licensing notes for new records, and independent relevance or abstention labels kept separate from tuning cases.
