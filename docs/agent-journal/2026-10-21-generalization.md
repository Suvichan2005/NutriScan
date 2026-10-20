# 21 October 2026 — generalization and intake checkpoint

## Scope

Continued the existing local NutriScan implementation. No source history or remote existed before this first checkpoint. Current work corrects example-shaped personalization and fixed two-image intake while retaining the deterministic evidence engine, OCR, research routes and existing green design system.

## Changes

- Replaced the profile contract with empty, optional, separate dietary preference, allergy, intolerance, health consideration, goal, age/reference and location fields. Removed the example-specific meal-count extractor and production calculator. Public search remains independent of the private profile.
- Changed the front/back pair into a variable image collection (up to 10) with add, camera capture, preview, removal, replacement, optional per-photo hint/note and a per-image OCR crop target.
- Added product detail and free-form question fields; product-only investigation can start without a photo. Removed the three canned follow-up chips.
- Updated local follow-up handling to consider only user-declared context when a personal suitability question makes it relevant. The package arithmetic remains deterministic and independent of profile defaults.
- Updated architecture, privacy and acceptance records. The profile remains session-only; no health profile is sent in public searches or saved in history/export.

## Verification level

- Static TypeScript check: passed.
- Unit suite: 53/53 passed.
- Core synthetic suite: 20/20 passed; 29/29 annotated fields, 4/4 annotated absences, 11/11 withholding checks and 19 numerical comparisons.
- Local retrieval suite: 12 queries and 7 documents; hybrid top-1, recall@3 and MRR@5 each measured 1.0 on this developer-authored tuning set.
- Optimized Next production build: passed.
- Codex in-app screenshot audit was blocked by Work settings. This continuation used installed Chrome through Playwright for fresh first-visit, text-only and follow-up screenshots and accessibility checks; details are in [UX_AUDIT.md](../UX_AUDIT.md).
- Provider: Gemini disabled; no key configured and no live call.
- Git: local branch `main`, no configured remote. Implementation checkpoint commit: `6f7b375`.

## Follow-on OCR diagnostic

- Added `npm run ocr:evaluate`, a reproducible Node diagnostic using the production parser and five genuine public source photographs whose local bytes are SHA-256 checked against the ignored-photo manifest.
- Across 37 visually annotated nutrient fields, the current best 3,000 px quality-98 English Tesseract pass matched 2 fields, omitted 34 and withheld 1. The English-only model matched no fields on the one French and one Spanish nutrition panel. A native automatic-page pass produced two wrong values; one Saffola sodium reading was 10x the visual annotation.
- The diagnostic stores aggregate and field outcomes only, not source photographs or raw OCR text. The detailed method and limits are in [REAL_OCR_EVALUATION.md](../REAL_OCR_EVALUATION.md).
- These results are a small Node diagnostic, not an end-to-end browser result, independent blinded benchmark, or estimate of expected real-world accuracy. They do not justify automatically accepting extracted values. Gemini remains disabled without credentials.

## Browser journey and portion correction

- Used installed Chrome with Playwright at mobile 390 × 844 and desktop 1440 × 1000. Fresh screenshots and the visual review are recorded in [UX_AUDIT.md](../UX_AUDIT.md). Axe found zero violations in the checked first-visit and result pages; the optional context dialog showed eight empty controls.
- The browser run found that an amount in the initial question was ignored while follow-up amounts worked. Added a shared requested-portion resolver and tests. “How much sodium is in 50 g?” now selects 50 g and displays 200 mg from the test label; a 25 g follow-up updates to 100 mg.
- The mobile screenshot exposed wrapping in the workspace navigation. Updated mobile flex/nowrap and small-text styles; current 390 px screenshot shows the navigation on one line.
- Re-ran local browser OCR on four genuine photos across Saffola, Bagrrys and Coca-Cola investigations. No image set yielded a usable nutrient calculation; noisy, conflicting, or basis/unit-incomplete readings remained unknown. This agrees with the low Node diagnostic yield and strengthens the case for targeted crop/language-mode experiments while preserving fail-closed behavior.
- Gemini remains disabled; browser camera hardware and full image editing interaction are not verified.
- An optional offline French/Spanish OCR probe compared language-specific and English-plus-language data with automatic and single-block segmentation on the two non-English annotated images. All 56 per-run field comparisons were omitted and the parser produced no nutrient rows. The optional packages remain out of normal dependencies and browser assets; see [REAL_OCR_EVALUATION.md](../REAL_OCR_EVALUATION.md) and the machine-readable [probe result](../evidence/real-ocr-language-probe.json).
- A six-variant Saffola preprocessing probe found two exact-basis matches from 9 fields at 3,000 px upscaling or grayscale/normalize/sharpen, while green/blue channel isolation and hard thresholding returned none. The current 3,000 px full-set proxy matched 2/37 versus 1/37 at 2,200 px; in-browser Saffola also exposed two values, but their basis remained unresolved. The browser now uses 3,000 px/quality 98 and continues to withhold values without a basis. Reproducible single-photo results are in [real-ocr-preprocessing-probe.json](../evidence/real-ocr-preprocessing-probe.json).
- Added basis-aware comparison of package readings and community product records. A live barcode lookup was compared with a controlled 25 g label fixture: shared values were normalized to 100 g and matched, while absent package fields stayed out of comparison. Unit tests cover energy/sodium conversions, zeros, conflicts, unknown bases and mass/volume mismatch. The first browser run exposed a horizontal-scroll accessibility issue; the focusable region fix cleared axe. See [integration receipts](../INTEGRATIONS.md).
- Removed the production fallback to the demo label's 30 g amount. The calculation starts from a dimension-compatible declared serving or a non-conflicted label basis; if neither exists, it uses a labeled 100 g/ml reference, explicitly described as not a personal serving recommendation. Added regression cases for each branch. TypeScript, all 69 tests and `git diff --check` pass. CUA reports that local browser use is disabled; screenshot review of this copy change is still pending.
- Hardened optional-context assembly: the Gemini request now omits `profile` when all user-entered context fields are blank. The shared predicate treats whitespace as empty; tests cover empty, whitespace-only and populated context. Live Gemini transport remains unverified because no credentials are configured.
- Completed candidate discovery without requiring a profile country. A user-entered country optionally filters community country tags, and the current product barcode is excluded from the candidates when available. Removed the unreachable `alternatives` branch from `/api/research`; candidate discovery lives in the product catalog route. Live localhost Open Food Facts query `oats` returned four canonically enriched records with explicit `100 g` bases and varied country tags; no stock or “better” claim is made. Request receipt: `b0fb9041-fa6e-4821-8cdc-02ee4cd35656`.
- Extracted candidate request construction and tested exact barcode lookup, global search without inferred country, trimming an actually supplied country, using the scanned package name when the field still contains its barcode, and excluding that current barcode. Current verification: 74 tests pass across 8 files; TypeScript and optimized Next production build pass. No current screenshot is claimed for this updated candidate-search wording because the in-app browser is disabled.
- Split optional food-allergy and food-intolerance fields in the session profile, prompt representation and follow-up prompts. The UI says these are distinct user-declared details and that a label cannot establish medical safety or rule out cross-contact. Tests verify independent context handling. The first-visit profile dialog now has a revised field count/layout; a new visual and accessibility pass is pending browser access.

## Limits

Additional browser acceptance is still required for photo removal/replacement, keyboard focus, camera hardware and consented image selection. OCR remains imperfect on glossy, multilingual and multi-column packaging. Product identity and changing regulatory claims need exact, dated corroboration.
