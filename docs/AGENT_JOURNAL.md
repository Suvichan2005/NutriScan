# Sanitized engineering journal

## 2026-10-21 — executable OCR research contracts

- Added strict TypeScript/Zod contracts for annotated image data, a common transient engine output and sanitized per-image result receipts. A common scorer now separates exact numeric/operator, unit and basis correctness; omissions, abstentions, conflicts, false positives and unscorable references remain distinct.
- Added targeted checks for printed zero, wrong-basis values, omission versus abstention, conflicting candidates, unscorable references, raw-text/config-secret exclusion, input hash mismatch, product-group split leakage and per-stage geometry. Eleven focused tests pass; the full suite passes 261 tests across 27 files, with typecheck and production build successful.
- Rechecked three additional public package-photo candidates against official Open Food Facts metadata and verified local SHA-256/dimensions. No OCR run has touched them. They are unassigned pending independent human annotation; one blurry source photo is excluded from clear numeric scoring. Image-specific redistribution review remains pending.
- No production OCR change, Gemini call, paid provider call, source image commit, or public deployment occurred. The previous five-photo OCR results remain exploratory and do not estimate population accuracy.

## 2026-10-21 — local package-text conversation

- Added deterministic answers for questions about ingredient text, allergen statements, and package claims, linked to their recorded observation IDs. The answer preserves the OCR/transcription uncertainty; absent text remains unknown.
- Chrome/Playwright passed a synthetic-label intake and follow-up journey at 390×844 and 1440×900. No Axe violations, page errors, or off-loopback requests were observed. This is not real-photo OCR, general language-model, or provider evidence.
- Re-ran the hash-verified Saffola photo journey at both sizes: 22 OCR observations, one parsed nutrient row, one exact saturated-fat observation, and a corrected 50 g calculation with original observations retained. This reproduces the earlier UI behavior and establishes no OCR accuracy gain.
- Full verification passed: 250 unit tests across 26 files and TypeScript typecheck. Gemini remained disabled; no provider request was made.
- No source images, private chat content, provider secrets, health context, or raw request bodies were added to this entry.

## 2026-10-21 — incremental package photos

- Implemented incremental OCR selection keyed by photo ID and OCR-affecting settings.
- Added image provenance to derived label observations and a conservative merge for follow-up package evidence. Prior investigation identity, portion and conversation remain; same-photo evidence is deduplicated; compatible disagreements are retained as conflicts; barcode changes are surfaced.
- Added focused merge and provenance regressions. `npm test` passed (88 tests / 12 files), `npm run typecheck` passed, and `npm run build` passed.
- Browser verification of the new follow-up-photo journey remains pending. No real-package OCR accuracy or provider integration is claimed by these tests.
- No personal health context, source package images, provider secrets, request bodies or private handoff content is recorded here.

## 2026-10-21 — joined text, details and photos

- Pasted label text now augments the current investigation instead of replacing it; attached, unprocessed photos remain available for the next OCR step.
- Optional product details now persist as an explicit user-originated observation separate from OCR label text. Local audits label it unverified; the Gemini instruction preserves that distinction. Product lookup can use this detail when package identity remains unidentified.
- Updated history/export disclosure for saved product details. Added tests for provenance, deduplication, server-contract acceptance and local audit context. Verification: 92 tests, typecheck and production build passed. A fresh optimized process returned HTTP 200 and `/api/status` returned `ok` with Gemini disabled; browser acceptance is still pending.
- `npm audit` and `npm audit --omit=dev` each reported zero known vulnerabilities during this checkpoint.
- Nutrition calculations now carry provenance links for separate basis and serving-size declarations; matching readings across photos retain links to both sources. Regression coverage passes.
- Latest verified local state: 93 tests / 12 files, typecheck, optimized production build and `git diff --check` passed. Browser-only acceptance remains pending the selected-browser question.
