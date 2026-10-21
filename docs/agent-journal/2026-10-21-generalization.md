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
- Added conservative literal mention checking against the extracted ingredient/allergen text, with supporting observation IDs. A text miss explicitly leaves synonyms, derivatives, OCR omissions and cross-contact unresolved; no “safe” outcome is generated. Verification is now 78 passing tests across 9 files, a clean TypeScript check and successful optimized Next build.
- Extended the real-photo Node diagnostic to compare prepared AUTO and SINGLE_COLUMN segmentation against the existing SINGLE_BLOCK pass, and added aggregate parser row/basis/conflict/ingredient/claim counts without persisting raw OCR. On the five-photo, 37-field set, prepared AUTO returned zero unconflicted explicit-basis rows; SINGLE_BLOCK returned two on one photo and matched two fields overall, with no incorrect matches. This small selected diagnostic does not justify adding a second OCR pass to ordinary scans. Reproduced with `npm run ocr:evaluate`; report: [REAL_OCR_EVALUATION.md](../REAL_OCR_EVALUATION.md). No runtime behavior changed.
- Added bounded selectable-text extraction for allowlisted official Gazette PDFs, with a dated FSSAI 2026 amendment registry entry and separate publication/effective dates in the research result UI. PDF.js tests cover extracted text, page/character caps, source-date separation and HTML challenge rejection. The actual FSSAI URL returned HTTP 200 with `text/html` during the local probe, so the feature remains fixture-tested rather than live-source verified. See [regulatory snapshot](../REGULATORY_SNAPSHOT.md) and [integration limits](../INTEGRATIONS.md).

## Limits

## Continuation checkpoint — repeatable browser OCR crop probe

- Added `npm run ocr:evaluate:browser-ui`, which verifies the local Saffola source-image hash and drives the production browser upload/OCR flow on loopback Chrome at mobile width. Four cases compare unknown role, nutrition role, a user-directed crop and a repeated crop. The versioned receipt contains only aggregate outcomes, screenshot paths, axe IDs and page-error counts; screenshots and source photos remain ignored/private.
- Results on nine manifest annotations: unknown role/full image 0 correct / 0 incorrect / 9 omitted; nutrition role/full image 0 correct / 0 incorrect / 8 omitted / 1 withheld; the selected crop matched one field with 0 incorrect and 8 omitted on both runs. All runs had zero page errors and axe violations.
- The browser crop result differs from the earlier Node proxy using identical bounds. Treat the evidence as a single-photo browser-path observation; do not change automatic crop/role behavior or claim broader OCR improvement. Method and limitations are in [REAL_OCR_EVALUATION.md](../REAL_OCR_EVALUATION.md).

## Continuation checkpoint — question-first intake and example audit

- The existing open-question field was below photo selection, making question-first behavior possible but visually secondary. Moved the single field above image selection; removed the duplicate location. Text-only/product-only paths and the scan handler already preserved the initial question, so no example or canned question was introduced.
- Fresh mobile Chrome acceptance entered a non-personal question before attaching the hash-verified photo, confirmed it appeared in the conversation after OCR, and found zero axe violations on both the initial intake and result view.
- Scoped source audit found no chapati/roti-specific production flow or seeded health profile. The only active product example remains behind “Explore a sample label,” and is visibly labeled synthetic/no real product verdict. Health sources are selected by question matching; the Gemini instruction describes limits but does not assert a user diagnosis. Existing tests cover empty-profile behavior and reject the obsolete chapati field.
- Verification after the intake change: typecheck, 107 tests, optimized build, browser OCR evaluation and `git diff --check` pass. The small OCR crop result remains 1 correct / 0 incorrect / 8 omitted in two repeats; no OCR policy changed.
- Checkpoint: `e8bb1477c4cfabe02fbba7430d8f18b77cd4cb77` (`Move question-first prompt ahead of photo intake`).

## Continuation checkpoint — current regulatory retrieval boundary

- The live local `/api/research` route on the existing port 3400 returned `unavailable`, two official FSSAI navigation-only cards and no current-law verdict for a same-origin `FSSAI labelling` request. An Origin-less request was rejected with 403 before source work.
- Direct local retrieval of the official FSSAI PDF still returns an HTML challenge; a guessed eGazette PDF URL returned 404. The official eGazette homepage and interactive search form load, but the exact PDF download path has not been captured. No TLS validation was bypassed and no law text was inferred from search indexing.
- Recorded in [INTEGRATIONS.md](../INTEGRATIONS.md). The next independent source-path task is a session-bound eGazette UI lookup followed by direct TLS/content-type verification of its exact returned URL.

## Continuation checkpoint — official eGazette navigation fallback

- When every matched FSSAI source fails, the local research response now adds an official Government of India eGazette search link marked navigation-only. The portal is not fetched, excerpted, or treated as law evidence; `status: unavailable` and the no-current-law-verdict message remain unchanged.
- Focused regression tests verify the card, limitations, and that the eGazette host is not fetched. Full suite: 107 passing; TypeScript and optimized build pass.
- Optimized loopback API acceptance on port 3413 returned two FSSAI links plus the eGazette card with the unavailable status and no-verdict message. This validates the fallback response only; actual Gazette PDF retrieval remains unresolved. See [INTEGRATIONS.md](../INTEGRATIONS.md).
- Checkpoint: `b8b2f0a9c5e5f30a4f833faa5cf484f5fe946c7d` (`Add official Gazette navigation fallback`).
- Local evidence checkpoint: `8c05d488550d644d0243dcc882b55c866f25644e` (`Add reproducible browser OCR crop evaluation`). Typecheck, all 107 tests, optimized build, the repeatable browser command and `git diff --check` passed; private screenshots remain ignored.

## Continuation checkpoint — research source-selection guard

- Fixed-registry research previously selected two source cards even when the query had no registry match, and substring scoring could count incidental fragments. Replaced that with whole-token normalized term/phrase matching, removed the blanket FSSAI score, and return an explicit unavailable result with no network fetch when nothing matches.
- Regression tests cover an unrelated query/no-fetch case and a registered hyphenated phrase. This improves source relevance only; it does not broaden or certify regulatory coverage. The later full suite includes this change.
- Built-app acceptance on temporary loopback port 3411 returned `unavailable` and zero source cards for `almond manufacture`; request `471c6dbb-1597-4082-a5ed-fa37ec69e603`. The temporary listener was stopped and verified absent. The detailed receipt is in [integrations](../INTEGRATIONS.md).

## Continuation checkpoint — sparse catalog comparison

- Comparison previously iterated only over nutrients present in the community record, silently hiding package-reported nutrients missing from that record. It now emits rows for the union of package and catalog nutrients and labels catalog omissions as “not reported”; no missing value is converted to zero.
- Added a regression case for sodium reported on the package but absent from the catalog. Verification: full suite 105 passing across 13 files, TypeScript typecheck, optimized production build, and `git diff --check` pass. The updated visual row still awaits fresh browser presentation review.

## Continuation checkpoint — population scope for sodium context

- A general-adult WHO sodium reference could previously appear even when a user explicitly supplied a child/adolescent age group. The audit now retains the package-derived amount, withholds the adult percentage for clearly under-18 age text or age ranges, states that no pediatric target was inferred, and asks for applicable age-specific guidance.
- Regression test covers a declared 16-year-old with a sodium label value. Verification: full suite 106 passing across 13 files, TypeScript typecheck, optimized production build, and `git diff --check` pass. This guard does not classify ambiguous ages or determine personal suitability.

## Collaboration journal integration check

- Read the installed collaboration-status workflow and performed a read-only check. The collaboration launcher is present/running globally, but this repository has no `collab.json`, `agent-journal/state.json`, runner lock, or `Codex-Collab-Daemon` scheduled task. No project-specific sync, inbox, or quota status can be established from this checkout.
- The sanitized chronological journal remains versioned locally. No connector enrollment, journal publication, or configuration change was performed.

Additional browser acceptance is still required for photo removal/replacement, keyboard focus, camera hardware and consented image selection. OCR remains imperfect on glossy, multilingual and multi-column packaging. Product identity and changing regulatory claims need exact, dated corroboration.

## Continuation checkpoint — incremental multimodal input

- Follow-up image reads now preserve the active package identity, portion and conversation, carry image IDs into parsed observations, skip unchanged attachments, and retain conflicting comparable values for review. Barcode, brand and license disagreements are made explicit.
- Pasted text can enrich an existing investigation without detaching its photos. Optional user product details are stored as user-originated context separate from OCR, linked to an observation, and labeled unverified in local audits and the Gemini instruction. Product details are included in history/export disclosures.
- Verification: 92 tests across 12 files, TypeScript check, optimized production build, fresh localhost production-process HTTP 200 and `/api/status` `ok`, with Gemini disabled. Full and runtime-only `npm audit` both returned zero known vulnerabilities.
- Re-ran `npm run ocr:evaluate`: the five-photo, 37-field aggregate reproduced the recorded totals (single-block prepared 2 correct / 0 incorrect / 34 omitted / 1 withheld; enhanced 2 / 0 / 33 / 2). No new OCR change is justified by this small set.
- Calculation provenance now links nutrient values to the separate basis and declared serving observations used for scaling. When different photos yield the same reading, numeric deduplication keeps observation links from both sources. Tests cover this basis/source trace.
- Final focused suite at this checkpoint: 93 tests across 12 files; typecheck and optimized build passed.
- Added bibliographic metadata for the official ICMR-NIN Dietary Guidelines for Indians, Revised Edition 2024. The research corpus links to the official publication and does not reproduce its contents because the source notice restricts electronic product use without prior written permission.
- Regenerated the local MiniLM index and 12-query developer retrieval report after adding the eighth source record: lexical top-1 11/12, semantic 12/12, hybrid 12/12. The query set remains small and hand-authored; no clinical or held-out accuracy claim is made.
- Wired intent-matched local source summaries into package audits as scoped references; these cited sources now enter consented synthesis context. Profile text is excluded from retrieval query construction, and current-law questions do not receive unrelated ICMR guideline metadata. Source linkage and query-scope tests pass; 94 tests, typecheck and optimized build pass.
- Regulatory research failures now retain official source links as navigation-only cards, with no invented source excerpt or interpretation. New local probes observed the official FSSAI site/PDF as a client shell previously and Windows Schannel `CRYPT_E_REVOKED` on 2026-10-21; TLS validation was not bypassed. The route remains unavailable for live text extraction. Test suite: 95 passing; typecheck and optimized build pass.
- Built-app HTTP acceptance on temporary loopback port 3401 confirmed `POST /api/research` with non-personal query `FSSAI labelling` returns `unavailable` plus two official navigation-only links and a no-text/no-current-law-verdict message (request `2c68a945-71e8-4a00-b3cc-7b8e94c36cb0`). The owned process was stopped; no listener remains on 3401. This does not establish browser rendering or live law retrieval.
- Added a hash-checked, reproducible OCR scale probe for 3,000/4,500/6,000 px images. On the same five-photo, 37-field set, 3,000 px matched 2 fields with 0 incorrect; larger sizes matched none. Retained the existing browser cap and recorded output without raw OCR/photo bytes; no runtime change was justified. See `docs/REAL_OCR_EVALUATION.md` and `docs/evidence/real-ocr-upscale-probe.json`.
- Added optional browser-native barcode detection for supported EAN/UPC formats. Check digits are validated, each observation keeps its image ID, barcode-only images can start an investigation, and disagreement among images or with OCR withholds product lookup. MDN documents limited availability; no browser/device barcode acceptance is claimed. Suite now has 100 tests; typecheck passes.
- Local checkpoint `266239e12ea94cab486cf6dc483e033be8bb34f5` records the feature. A final API-contract review corrected the detector input to a locally created `ImageBitmap`, which is always closed after decoding; optimized build and all 100 tests pass.
- Independent review found that a barcode mismatch arriving in a later photo warned but still retained the earlier lookup code. Added an explicit persisted `identityConflict`, cleared the catalog identifier and default query on barcode/brand/license disagreement, and added merge-to-lookup regression coverage. Suite now has 101 tests; typecheck and optimized build pass. Real-browser conflict flow remains unverified.
- Follow-up review found manual catalog search could still compare a selected record with merged, identity-disputed readings. Disabled that comparison action, added a function-level status that withholds every normalized value, and displayed an explanation. Suite now has 102 tests; typecheck and optimized build pass. Real-browser interaction remains unverified.
- Checkpoint `85ad7d701be677f557bc8964bacff12c3f99f021` records the comparison guard. Earlier same-session code checkpoints are `eaad91231c44e3cfc312c8a8f393777452ab60e8` (lookup withholding) and `284d3e0644900830a688804a716b3929f0fba265` (reproducible crop diagnostic).
- Added a hash-verified reproducible crop probe for the existing nutrition-role `SINGLE_BLOCK` path. On two difficult labels / 17 annotated fields, the full-frame control matched 2 with 0 wrong, while a tight crop on each image matched 0 and removed both Saffola matches; Bagrry's two-column issue persisted. No runtime crop/default changed. See `docs/evidence/real-ocr-guided-crop-probe.json`.
- Commits: `eaad912` (withhold catalog lookup on identity conflicts), `284d3e0` (measure user-directed OCR crop results). The crop run reproduces the 2/17 full-frame matches on the selected pair; targeted crops matched 0/17. The larger five-photo/37-field scale rerun reproduced its recorded counts exactly.
- This is not fresh browser acceptance: selected-browser proof for adding photos and text after an analysis remains pending. No provider invocation or new real-photo OCR accuracy result is claimed.
- Checkpoint commits: `83a6c48` (photo evidence merge), `a4fb141` (joined text and user details), `18a95be` (runtime and dependency verification).

## Mobile UX and OCR false-positive correction

- A fresh first-visit screenshot audit at 390 × 844 showed the three helper steps remaining in three columns below 700 px. The narrow heading also lost a word boundary when its `<br>` was hidden. The helper is now one column on mobile, and the heading wraps naturally.
- Real Chrome checks confirmed nine blank optional context controls, two-photo input, per-photo hint and note, remove and replace, open-ended text-only analysis, and a portion follow-up. A 50 g sodium question returned 200 mg; a 25 g follow-up returned 100 mg on the same investigation. A genuine public Coca-Cola label photo was read after analysis while retaining both turns and the chosen 25 ml amount. No formulation match or OCR accuracy is asserted.
- That genuine-photo run exposed low-confidence `hy E000` OCR outside an ingredient section, which was displayed as an unresolved additive. Package additive extraction now uses parsed ingredient text only; a regression test and repeated browser flow confirm the false additive no longer appears while the raw OCR remains inspectable.
- Scoped Axe scans reported zero violations on mobile first visit, optional-context dialog, and the text-only results/follow-up state. No page errors or horizontal overflow occurred. Captures inspected and recorded in `docs/evidence/19-24-*.png`; full keyboard traversal, camera hardware and phone performance remain untested.
- Codex in-app browser is disabled in Work settings; the audit used locally installed Chrome through Playwright. Gemini remains disabled, no external provider was invoked, and no network retrieval was needed for this milestone.
- Verification completed: 108 tests across 13 files, TypeScript check, optimized build in an isolated validation copy so the existing local app stayed available, and `git diff --check`.

## eGazette search retry

- The official eGazette home page returned HTTP 200 in ordinary Chrome with its anonymous session-bound route. A credentialed same-origin request to `SearchMenu.aspx` timed out after 8 seconds. Official-domain search did not return the target First Amendment PDF; the surfaced `272858.pdf` is an unrelated draft amendment and was excluded.
- No session-state inspection, authentication bypass, TLS exception, or new source URL was used. NutriScan continues to return `unavailable` and only presents the eGazette navigation fallback. This route is blocked on the government search page responsiveness or a verifiable exact official document URL; other application work can continue.
## 2026-10-21 — cross-browser barcode fallback

- Chrome on this machine has no native `BarcodeDetector`. Added a lazy local ZXing fallback for checksum-valid EAN-13, EAN-8 and UPC-A decoding; native detection remains preferred and any decode failure falls through to OCR.
- Added Vitest coverage for fallback invocation, native-to-fallback recovery, validation and safe failure. Full test suite: 219 passed; typecheck passed.
- A synthetic browser test generated EAN-13 `4006381333931` in Chrome and decoded it through the production function with native `BarcodeDetector` absent. Reproduce with `npx tsx scripts/evaluate-barcode-fallback.mts`.
- Three initial package-photo scans predated the fallback build and did not establish real barcode accuracy. A fresh isolated production build with fallback enabled was then scanned in Chrome at 390×844 and 1440×900 using a Heinz front-only photo; intake guidance appeared at both sizes and the scan reached results without a code, as expected for an image without a visible barcode. No suitable real barcode photo was available.
- New runtime dependencies are pinned to `@zxing/browser@0.1.5` and `@zxing/library@0.21.3`. `npm audit` found zero vulnerabilities. Isolated production compilation and prerender completed with Webpack. The initial Turbopack run could not resolve the external `node_modules` junction and was not used as a build result.
- Follow-up production-source audit found an all-empty `defaultProfile` and blank question state. The sole sample label is available through an explicit button, labeled synthetic in the UI and represented with fixture provenance; diabetes terms in production code are retrieval and safety guidance, not default context.
