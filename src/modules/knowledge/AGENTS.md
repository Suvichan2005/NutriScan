# Knowledge module contributor instructions

You may modify files under `src/modules/knowledge/**`. You may read the rest of the repository to understand the stable interface.

Do not modify shared schemas in `src/lib/contracts.ts`, compatibility facades in `src/lib/`, OCR/parser or inference internals, the product engine, API routes, UI, root scripts/configuration, model/provider enablement, or another module. If your work needs one of those changes, describe the narrow interface or integration change in your PR for the owner to implement.

Preserve source attribution, jurisdiction, publication/effective/retrieval dates, limitations, and licensing notes. Do not treat a source's presence as permission to redistribute its text. Keep live source fetching and HTTP policy in the owner-controlled server layer unless the owner approves a callback-based adapter contract.

Keep exact identifier lookup, lexical matching, semantic ranking, source applicability, and abstention behavior distinct. Similarity is not evidence quality or entailment. A tentative OCR entity match must preserve its observed text and must not establish package presence, dose, product identity, current law, authorization, or personal safety.

Use only public/non-sensitive fixtures. Do not add user photos, profiles, conversation data, credentials, or copyrighted source text. New source records require direct provenance and a documented license review state. Do not modify evaluation labels after measuring a candidate against them; separate tuning cases from held-out relevance cases.

Before proposing integration, run `npm test -- src/modules/knowledge/knowledge.test.ts` and state what was tested. A module PR must describe the behavior change, source/provenance impact, evaluation scope, limitations, and any required owner-controlled integration. Do not claim independent relevance, legal, or clinical validation from developer-authored fixtures.
