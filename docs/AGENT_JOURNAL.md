# Sanitized engineering journal

## 2026-10-21 — incremental package photos

- Implemented incremental OCR selection keyed by photo ID and OCR-affecting settings.
- Added image provenance to derived label observations and a conservative merge for follow-up package evidence. Prior investigation identity, portion and conversation remain; same-photo evidence is deduplicated; compatible disagreements are retained as conflicts; barcode changes are surfaced.
- Added focused merge and provenance regressions. `npm test` passed (88 tests / 12 files), `npm run typecheck` passed, and `npm run build` passed.
- Browser verification of the new follow-up-photo journey remains pending. No real-package OCR accuracy or provider integration is claimed by these tests.
- No personal health context, source package images, provider secrets, request bodies or private handoff content is recorded here.

## 2026-10-21 — joined text, details and photos

- Pasted label text now augments the current investigation instead of replacing it; attached, unprocessed photos remain available for the next OCR step.
- Optional product details now persist as an explicit user-originated observation separate from OCR label text. Local audits label it unverified; the Gemini instruction preserves that distinction. Product lookup can use this detail when package identity remains unidentified.
- Updated history/export disclosure for saved product details. Added tests for provenance, deduplication, server-contract acceptance and local audit context. Verification: 91 tests, typecheck and production build passed. A fresh optimized process returned HTTP 200 and `/api/status` returned `ok` with Gemini disabled; browser acceptance is still pending.
- `npm audit` and `npm audit --omit=dev` each reported zero known vulnerabilities during this checkpoint.
