# Sanitized engineering journal

## 2026-10-21 — preserve OCR-to-assist evidence and allow labeled synthesis

- Extended the product package with capture metadata, explicit per-image OCR line ordering, and nutrient parser decisions linked to the observations they considered. Raw lines remain present when a parser rejects a candidate; disagreement remains a conflict.
- The consented assist contract now includes retrieved sources and deterministic local calculations. It can return exact quotations or paraphrases with exact cited spans, plus structured suggestions marked `tentative` and tied to original OCR lines. The server does not promote suggestions into package facts, and the client never sends photo bytes on the text-assist route.
- A synthetic offline test checked approximate protein rejection, conflicting sodium values, candidate traceability/non-promotion, calculation references and the disabled-provider boundary. 278 tests and typecheck passed at the checkpoint; no real photograph, browser interaction, provider call, accuracy result or entailment validation was established.
- The generated response remains an unverified interpretation even when citation IDs and spans validate. The simple high-risk lexical filter is not a complete medical-safety control; Gemini stays disabled pending owner authorization and separate evaluation.

## 2026-10-21 — connect observed additive codes to official research

- Added a shortcut on additive-code findings. It prepares the known local identity and observed INS code for the Indian regulation search, then focuses the search field; the user must review and submit explicitly.
- Mobile and desktop Chrome acceptance started from synthetic pasted label text with xanthan gum/INS 415. It confirmed detection, prefilled query/topic, no research request before the user's button click, and exactly one request after. The official Appendix A excerpt, companion amendments index, source caveats and scope disclosures appeared. No provider or off-origin browser calls occurred; Axe, page errors and horizontal overflow were zero.
- The source request took 7.057 s on mobile and 8.121 s on desktop in this run. These timings varied from the previous live-source run and are not device-performance estimates. This accepts the synthetic-text-to-source workflow only; no package photo or OCR result was part of this test.
- No image bytes, health profile, conversation, source PDF or private handoff content was added to the repository.

## 2026-10-21 — retrieve official additive excerpts on demand

- Added a fixed FSSAI Appendix A source entry plus companion additive-amendments index for additive/INS queries. The PDF has source-specific byte, page, character and excerpt bounds; the general PDF extraction budget was left unchanged, and unrelated label/ORS regulation queries do not fetch either additive source.
- A live Chrome test revealed excerpt ranking chose common document boilerplate over a relevant Xanthan/INS 415 row. Updated ranking to weight rare query terms and numeric identifiers; added a regression with repeated boilerplate. The production API now returns the matching excerpt while keeping exact category use and legal status unresolved.
- Mobile and desktop isolated-production Chrome acceptance passed at 390×844 and 1440×900. Route times with both official sources were 8.349 s and 7.145 s; both returned HTTP 200. The publisher/source link, amendment-index link, and nonbinding, Gazette-precedence and category caveats appeared. Axe violations, page errors, horizontal overflow, browser provider calls and off-loopback browser requests were zero.
- The request used synthetic label text and public-source research; it did not process a package photograph or evaluate OCR. No full PDF, raw source excerpt, source image, personal health data, credential or private handoff text is stored in the repository. This does not establish current additive authorization or package compliance.

## 2026-10-21 — separate on-device profile context from scan history

- Added a distinct opt-in for remembering user-entered context in local IndexedDB. Default profile remains empty; scan and conversation contracts and JSON exports continue to omit profile fields. Clearing or unchecking the option removes only the remembered copy while session context is preserved for uncheck.
- Updated the profile and privacy disclosures for browser-profile visibility, lack of encryption/sync, selected-country lookup behavior and separate Gemini consent. Reopening saved scans preserves only a separately opted-in profile; it never hydrates profile from scan data.
- Chrome/Playwright acceptance passed at 390×844 and 1440×900 using synthetic profile text. It verified reload restore, scan-history record exclusion, opt-out deletion, blank default, and zero axe violations, page errors, provider calls or off-origin requests. The initial run revealed that disabling the checkbox during a pending save prevented its state from settling; the control now updates immediately and reverts if persistence fails.
- Full tests passed (270 tests / 30 files), typecheck passed, and an isolated optimized Next build passed. Gemini remained disabled; no real-photo accuracy or provider claim is made.
- No personal profile values, source images, provider secrets, raw request bodies or private chat text were added to the repository.

## 2026-10-21 — real-photo structural diagnostic and annotation correction

- Corrected the local annotation workflow so a clear numeric row can state that no separate unit is printed, without inventing one or requiring nonexistent unit geometry. Chrome/Playwright round-tripped both an explicit unit and `unit: null` at 390×844 and 1440×900. It also verified that only the two unexposed candidates are selectable; the OCR-exposed Grandma's image and low-legibility Weet-Bix are excluded. No Axe issues, POSTs, off-origin requests, page errors or horizontal overflow were observed.
- Ran one private, hash-registered Grandma's Chocolate Brownie photograph through the browser product flow. Tesseract.js 7.0.0 produced 28 line observations; parser output retained two conflicting fat candidates with unknown bases and produced no usable calculations. The two numeric columns were not associated with separate bases. No independent transcript/polygons were available, so this is qualitative development evidence only and the product is excluded from held-out evaluation. See `docs/evidence/ocr-real-photo-structural-diagnostic.json`.
- Tightened local evidence selection so generic calorie/carbohydrate/sugar label questions do not surface diabetes education unless diabetes context or a sugar claim is explicitly asked about. Fresh isolated-build Chrome export showed no NIDDK source for the generic real-photo question; focused regression covers generic, explicit sugar-claim and diabetes queries.
- Full verification passed: 270 tests across 30 files, typecheck, isolated optimized Next build, and local Chrome/Playwright annotation acceptance. The photo was read in-browser; no POST/off-origin/provider call occurred, Gemini remained disabled, and no source image or raw OCR transcript was committed.
- No independent candidate has been annotated, no field accuracy was scored, and no OCR engine was promoted. The two remaining unexposed candidates still need independent human annotation and license review before any split lock.

## 2026-10-21 — opt-in local conversation continuity

- Added a strict saved-scan contract that remains compatible with package-only history and can hold up to 30 recent local turns. Saved turns reopen with their package evidence and calculation amount; the optional profile returns empty.
- Conversation persistence is a separate explicit choice. Its disclosure says questions can include personal details and that photos, profile fields and Gemini answers are excluded. Opting out strips turns from the saved record; clearing history removes both scans and turns.
- Full suite passed (269 tests / 30 files), TypeScript passed, and an isolated optimized Webpack build passed without changing the owner-managed `.next` directory. Chrome/Playwright verified two-turn restore, blank profile and opt-out removal at 390×844 and 1440×900; Axe, page errors, Gemini assist/vision calls and off-loopback requests were zero. Receipt: `docs/evidence/package-text-conversation-browser.json`.
- The browser exercise used synthetic label text and profile text. It is evidence of local storage and UI behavior only, not OCR accuracy, model reasoning or health-context personalization.

## 2026-10-21 — independent OCR annotation workflow

- Added a local browser route for blinded human transcription of real package photographs. Image bytes stay in tab memory; the export contains hash/dimensions, attribution, normalized table/row/field polygons, exact printed numeric text, normalized value/operator, unit, and serving basis. It excludes bytes, file names, paths and OCR output.
- Added strict schema generation and focused pass-contract checks. The route is annotation tooling only; it does not establish OCR accuracy or human-verified references. The three candidate photos still need two independent readers, adjudication and license review.
- Extended the public research protocol and annotation guide with reader independence, exact text preservation, metric denominators, privacy boundaries, and resource/network/cost measurement. Production OCR and Gemini configuration were unchanged.
- The pass comparison utility reports exact agreement by field dimension and bounding-box IoU by region role; it neither merges nor adjudicates. `npm test` passed (266 tests / 29 files), typecheck passed, and an isolated optimized production build passed. Chrome/Playwright synthetic-image acceptance passed at 390×844 and 1440×900 with no Axe violations, page errors, horizontal overflow, POSTs or off-origin requests. Receipt: `docs/evidence/ocr-annotation-workflow-browser.json`.
- No source images, private chat content, provider secrets, health context, or raw request bodies were added to this entry.

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

## 2026-10-21 — plain-language uncertainty in the package result

- Updated the result view to lead with a short explanation of unresolved label readings. Original parser notes remain available in a collapsed disclosure; OCR observations and package facts are unchanged.
- Fresh installed-Chrome acceptance on the hash-verified Saffola photo passed at 390x844 and 1440x900: 22 OCR observations, one parsed nutrient row, exact 3.4 g/100 g saturated-fat observation and a corrected 50 g calculation of 1.7 g. The optional context follow-up used a synthetic profile fixture; it withheld a personal daily target and linked the NIDDK source.
- TypeScript typecheck and 278 tests passed. Axe violations, page errors, off-loopback requests and provider calls were zero. Screenshots stay under ignored docs/evidence/private/core-journey-audit/. No OCR accuracy improvement or live Gemini behavior is claimed.
