# OCR contributor instructions — Yug

You may modify only `src/modules/ocr/**`. Read the repository root `AGENTS.md` for privacy, evidence, safety and local-development rules. You may read the rest of the repository.

## Stable boundary

- Use `src/modules/ocr/index.ts` as the public entry point and `src/lib/contracts.ts` as the single source of truth for shared package/observation/evaluation schemas.
- `readOcrImages` receives existing `ImageAsset` inputs and returns observed text with order, word boxes, recognition metadata and capture provenance. `parseLabel` returns the shared `PackageData` schema and parser diagnostics.
- The additive resolver and `beforeImage` hook are owner-controlled integration callbacks. Do not import Knowledge, UI state, barcode implementation, app storage, routes or Gemini into OCR.
- The `src/lib/browser.ts`, `src/lib/parser.ts`, `src/lib/ocr-annotation.ts`, `src/lib/ocr-evaluation.ts`, and `src/lib/label-uncertainty.ts` files are owner-controlled compatibility facades.

## Work and verification

Run `node src/modules/ocr/test.mjs` and `npm run typecheck` from the repository root. Fixtures in this directory are synthetic and need no API key, private photo or profile. Real-image evaluation scripts and annotation assets are owner-controlled; request an approved development image set and do not tune on the held-out split.

Keep raw observations and their source lineage when parsing fails. Retain conflicts, candidates, rejected readings and unknown units/bases; do not infer truth from OCR confidence, parser success or a fixture. Do not modify shared contracts, root scripts/configuration, docs outside this module, UI, routes, storage, consent or other module internals. Describe required integration changes for the owner to apply.

An acceptable change is a small, reviewable improvement with offline tests, unchanged global schemas, a clear measurement or failure case, and no unrelated edits. Do not commit; the owner owns integration and Git decisions.
