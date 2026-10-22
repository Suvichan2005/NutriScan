# NutriScan OCR module

This module owns browser-local image preparation and Tesseract recognition, nutrition/ingredient parsing, OCR diagnostics, and annotation/evaluation logic. The application calls it through `src/lib/browser.ts` and `src/lib/parser.ts`; those compatibility facades retain browser storage, barcode composition, and the Knowledge-supplied additive resolver.

## Public interface and evidence

`index.ts` is the module entry point. `readOcrImages` accepts existing `ImageAsset` records, progress/abort controls, and image-processing options. It returns recognized text, ordered line and word observations, confidence metadata, and capture provenance. The optional `beforeImage` hook lets the owner-controlled facade run adjacent package detectors without importing them into OCR. `parseLabel` consumes text and optional existing observations/captures and returns the shared `PackageData` contract. It can receive an additive resolver callback; without one, it does not guess additive identities.

Production Zod contracts remain in `src/lib/contracts.ts`. Parser failures do not discard OCR observations: the module retains line provenance and parser candidate/rejection diagnostics, and unresolved values or bases stay unresolved. The research `OcrExtraction` evaluation contract is separate from production `PackageData`; this module does not claim that every production OCR run is already emitted in the research extraction shape.

The checked-in fixtures are synthetic text/contract cases, not annotated real photographs or independent accuracy evidence. Private images and user profiles do not belong in this module. Real-photo evaluation must use owner-approved images and annotations, keep the held-out split locked, and report numeric value, unit, basis, omissions/abstentions and stage-level failures separately.

## Work and checks

Run the fixture tests from the repository root:

```powershell
node src/modules/ocr/test.mjs
npm run typecheck
```

The first independent work package is to improve nutritional-table field recovery on the owner-approved annotated development set, then assess against the locked held-out set without tuning on it. Focus on row/column association, numeric/unit/basis linkage and parser rejection after recognizing the relevant text. Do not start another engine survey absent a specific measured failure hypothesis.

## Contributor boundary

Yug owns OCR implementation files under `src/modules/ocr/**`; Yash owns `annotation.ts`, `evaluation.ts`, `fixtures/**`, annotation/evaluation tests and offline comparative runners under `evaluation-tools/**`. The public `index.ts`, global contracts, compatibility facades, barcode code, root scripts/configuration, cross-engine browser runners, application routes, UI, session state, consent, and other modules remain owner-controlled. Both contributors can run `node src/modules/ocr/test.mjs`. The owner may temporarily assign Yash OCR implementation files only when Yug is not working on overlapping paths.

An acceptable change includes a focused offline fixture test, preserved source provenance and conflicts, a reproducible module command, and a concise result/limitation note. Never promote a recognition candidate to a verified package fact; never assume an absent field is zero; do not add private photographs, profiles, API credentials, or network calls.
