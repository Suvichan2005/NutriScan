# Sanitized engineering journal

## 2026-10-21 — preserve correction lineage and audit the assist boundary

- Confirmed the existing consented text-assist contract retains ordered OCR lines, word text/geometry and uncalibrated scores, capture and session-image metadata, parser rejection/conflict candidates, retrieved sources and tentative structured candidates. Exact duplicate raw text alone is compacted. Candidate readings remain separate from package facts; image bytes require separate explicit consent.
- Confirmed the output contract already supports careful synthesis and profile-specific explanations with exact evidence spans and safety filtering. This is not a quote-only boundary, and exact spans do not prove entailment. Gemini stayed disabled and no provider call was made.
- Added user-correction links to the prior parsed nutrient and matching parser row/value/basis observations. Original OCR evidence remains unchanged, merge preserves links, and the evidence ledger now displays the correction and source excerpts. An assist-contract test confirms the distinction survives request validation.
- Chrome/Playwright on a hash-verified development photo passed at 390×844 and 1440×900: 16 OCR lines retained, four source observations linked to the correction, and the 50 g result remained 1.7 g. Axe violations and page errors were zero. This is workflow/provenance evidence, not OCR accuracy or model quality. Full suite: 327 tests / 34 files; typecheck passed.
- No photos, OCR text, profile details, keys, request bodies or private chat content were written to this journal.

## 2026-10-21 — keep complete OCR context inside the consented assist bound

- The assist path already carried raw ordered OCR lines, word geometry and uncalibrated recognition scores, capture/image links, parser rejections/conflicts, retrieved sources and tentative candidates. It already supported profile-aware synthesis with exact evidence spans; no quote-only policy change or provider call was needed.
- Removed duplicate `package.rawText` from the client/server model payload only when its lines exactly match the ordered OCR observations. Mixed or unmatched text is retained. A ten-photo offline contract fixture with 160 lines and all word metadata measured 253,902 bytes, so the assist request bound is now 300 KB; larger requests fail without truncation. This is not photo accuracy or provider acceptance. Full suite: 323 tests / 33 files; typecheck passed.
- Reviewed the official INDB portal and repository README. The portal offers a 1,014-recipe workbook, but the reviewed materials do not establish redistribution terms and IFCT inputs must be requested from ICMR-NIN. No data was downloaded or integrated; rights confirmation is an owner action.
- No raw OCR text, images, profile context, private conversation, keys or request body were added to the journal.

## 2026-10-21 — record unknown reuse terms instead of leaving license metadata blank

- Audited all 16 curated local evidence records. Eight lacked a license/terms note. Those now state that terms were not independently verified and that NutriScan retains only an original summary and link; recorded source restrictions remain explicit.
- Added a regression that rejects missing license-status notes. The knowledge summaries, source IDs, URLs and embedding input did not change; corpus version and index fingerprint still match, so no model download or index rebuild occurred.
- Full suite passed 321 tests across 33 files; TypeScript passed. This is source-provenance readiness, not legal clearance, new retrieval evidence or user-facing scientific accuracy.
- No source images, private chat content, profile data, credentials or request bodies were added.

## 2026-10-21 — link consented vision observations to their source image

- The OCR-to-assist review found no loss of raw OCR observations or parser candidate evidence in text assist. A separate gap existed after explicit image inspection: returned vision lines did not retain which selected photo/crop produced them. Vision outputs now carry an image/run link, and the package stores side, source dimensions, crop/preprocessing and model identifier. Later text assist preserves that link and checks a matching live handle.
- Dimensions are caller-supplied provenance because the inspection input is an already prepared crop; no original image bytes or durable digest are retained. Vision output remains unverified and compatible conflicts remain withheld. Image inspection still requires its separate consent action.
- Confirmed synthesis already supports concise profile-aware interpretation with exact spans, separate evidence identifiers, safety filtering and a disclosure that citations do not prove entailment. No quote-only change was needed. Gemini stayed disabled.
- Typed-text Chrome/Playwright acceptance at 390×844 and 1440×900 covered precautionary allergen wording and local context controls; zero Axe violations, page errors, provider calls or off-origin requests. Full suite: 321 tests / 33 files; typecheck and isolated optimized build passed. No photographed-label measurement changed; the Saffola development baseline remains one exact field of nine. No image-accuracy or live-provider claim is made.
- This entry contains no source images, private chat content, profile data, credentials or request bodies.

## 2026-10-21 — explain precautionary allergen wording and verify assist evidence readiness

- Added a local source-linked explanation of FSSAI “Contains” versus “May Contains” label wording using the original 2020 Gazette clause and the 2023 FAQ. The answer distinguishes listed ingredients from possible cross-contamination, and does not infer a package's actual allergen presence, exposure, personal risk, safety or legal compliance. Current compliance questions still require live official research.
- Rechecked the observation-to-assist contract and validator: ordered raw OCR lines, word text/order/confidence/geometry, capture and session-image provenance, parser-rejected/conflicting value and basis candidates, retrieval evidence, and tentative candidates already survive the boundary. Candidate interpretations remain separate from package facts; image bytes still require a separate explicit action. Labeled profile-aware synthesis is already supported, with exact evidence spans, source IDs and a disclosure that traceability does not prove entailment. No schema change or Gemini call was warranted.
- Refreshed the existing MiniLM index for corpus version `2026-10-21.8` using the six pinned model files already present locally; their recorded SHA-256 hashes matched, so no model download occurred. The unchanged 18 developer-authored ranking cases scored 17/18 lexical Top-1 and 17/18 Recall@3, 16/18 MiniLM Top-1 and 18/18 Recall@3, and 18/18 hybrid. Corpus growth reduced one lexical and one semantic metric; hybrid stayed level. All 13 developer-authored boundary cases passed. The real localhost evidence route returned the FSSAI FAQ first at corpus `.8`; cold latency was 2.082 s and subsequent probes 12–18 ms on this host.
- Offline suite passed 314 tests across 33 files; typecheck, optimized build and `git diff --check` passed. Production Chrome/Playwright at 390×844 and 1440×900 verified the synthetic typed-text allergen follow-up and six-turn local opt-in restore, with zero Axe violations, page errors, provider calls or off-origin requests. No real-photo OCR run was performed for this milestone; the existing Saffola result remains a single development image, not population accuracy. Gemini remains disabled. Browser receipt: `docs/evidence/package-text-conversation-browser.json`.

## 2026-10-21 — resolve child-specific fibre follow-ups locally

- Added a narrow local reference resolver for explicit age-group follow-ups to a WHO fibre-guidance question. It uses the preceding user question only; previous assistant text remains untrusted context, and the current prompt stays separate from any opt-in Gemini conversation history.
- Completed the OCR-to-assist review: the existing contract already preserves raw ordered OCR lines, word text/geometry/confidence, capture settings and session image handles, parser rejection/conflict candidates, retrieval sources, and tentative output candidates. The response boundary already supports exact direct quotations and labeled evidence-linked synthesis with distinct profile citations. No schema redesign or provider call was warranted; exact-span checks establish traceability, not entailment.
- Offline tests cover age-band guidance, unknown package amounts, and context isolation. The full suite passed 312 tests across 33 files; typecheck, optimized build, and `git diff --check` passed. Production-build Chrome/Playwright at 390×844 and 1440×900 verified the synthetic typed-text flow and five-turn local opt-in restore, with no Axe violations, page errors, provider calls, or off-origin requests. This is not real-photo OCR or Gemini evidence; Gemini remains disabled.

## 2026-10-21 — route existing WHO carbohydrate-quality guidance into local audits

- Connected explicit whole-diet fibre/fiber, whole-grain, pulse/legume and carbohydrate-quality questions to the existing WHO guideline. Local replies summarize carbohydrate sources and, for fibre questions, distinguish adult guidance from age-specific child guidance. A 30 g package calculation stays 2.4 g from an 8 g/100 g observation and is separate from the whole-day recommendation; simple amount questions remain on the deterministic path.
- Re-audited the existing OCR-to-assist boundary against current client request construction, schemas and validator tests. Raw lines, ordered word evidence/geometry/confidence, parser rejection/conflicts and session image provenance remain available; tentative candidates remain span-linked and separate from package facts. Evidence-linked, profile-aware synthesis is supported with safety filters. No schema change was needed.
- Full offline suite: 308 tests across 33 files; typecheck and optimized production build passed. Installed Chrome/Playwright verified the synthetic text flow at 390×844 and 1440×900, including the WHO answer and reference card, with zero Axe violations, page errors, provider calls or off-origin requests. This is local knowledge-flow evidence, not OCR or provider evidence. Gemini remains disabled.

## 2026-10-21 — connect tentative entity matching to OCR observations

- Reviewed the existing observation-to-assist contract: it already carries ordered raw OCR lines and word geometry/confidence, capture settings and session image provenance, plus parser-rejected/conflicting numeric and basis candidates. Tentative provider candidates must cite original OCR lines and word indexes. Image bytes remain behind a separate explicit inspection action.
- Confirmed the response validator already supports direct quotes and evidence-linked synthesis, including declared profile context, with exact source-span checks, separate evidence IDs and a disclosure that citation matching does not prove entailment. No citation-policy change or provider call was warranted; Gemini remains disabled.
- Added bounded, source-backed fuzzy additive identity matching in the existing local audit. A controlled `Calciurn disodium edetate` OCR string now yields one uncertain INS 385 candidate linked to the original observation and FAO registry source; confirmed additives and nutrients are unchanged, and the existing 50 g calculation remains 1.7 g from 3.4 g/100 g saturated fat. The source was already the top retrieval result, so only candidate surfacing changed.
- Full offline suite: 302 tests across 33 files; TypeScript typecheck and `git diff --check` passed. A separate Chrome/Playwright regression on the same hash-verified Saffola photo preserved its existing one exact field, five omissions, three withholdings, one parsed nutrient row and 1.7 g 50 g calculation at mobile and desktop sizes; there were no browser errors, Axe violations, off-loopback requests or assist/vision route requests. This checks one-image integration stability, not candidate precision or general OCR accuracy; Gemini was not invoked.

## 2026-10-21 — verify alternatives flow and keep OCR capture provenance extensible

- Re-ran the product alternatives journey in installed Chrome at 390×844 and 1440×900. The synthetic typed label reached live Open Food Facts exact-record lookup, normalized comparison and four candidate products; nine rows were comparable and one was withheld. Identity, community-data and stock caveats stayed visible, the current barcode was excluded from alternatives, and Axe, page errors and browser off-origin requests were clear. This does not validate a real photographed product or recommend an alternative.
- Audited the consented OCR-to-assist boundary. Ordered raw text, word recognition metadata and geometry, capture/image linkage, parser rejection/conflict candidates, retrieval sources and deterministic calculations already survive validation. The output already supports labeled synthesis with exact spans and profile-specific context; its citations provide traceability, not entailment. Original image inspection remains separate and explicitly consented.
- Changed the capture schema to accept a bounded reader identifier so a future reader can preserve its identity through the existing contract. Added an offline pass-through/length test; no alternate engine was run or integrated. The five-photo OCR evidence and production reader are unchanged. Gemini remains disabled.
- Fourteen focused assist-contract tests and the full suite (296 tests across 33 files) passed; TypeScript typecheck and `git diff --check` passed. The browser comparison evidence remains synthetic-label workflow validation only.

## 2026-10-21 — separate OCR text visibility from structure and parser outcomes

- Reaggregated the existing official PP-OCRv5 receipt's field-stage flags over its 37 previously explored nutrient fields. Label text was present for 33 and matching numbers somewhere in recognized rows for 34; the approximate row grouper placed label and value together for 21 and label, value and expected unit together for 7. Basis text appeared somewhere in 31, while 16 parser candidates were emitted and 6 matched the declared basis. Final outcomes were 6 exact, 0 incorrect, 21 omitted and 10 withheld.
- This points to row/unit/basis association and parser acceptance as major visible failure stages, while raw labels/numbers are often present. The counts are proxies: number and basis checks can match unrelated text, row grouping is approximate, and no independent text-region/table-column annotation exists. Detection precision/recall and true cell association remain unmeasured; no engine or product change was made.

## 2026-10-21 — inspect OCR regions from the evidence ledger

- The evidence ledger exposed OCR words, confidence and prepared-image coordinates, but users had to leave the result and manually find the corresponding line in a photo.
- Added an explicit local preview for raw OCR lines that still have a session image and matching capture metadata. It reconstructs the same crop and preprocessing, checks the result dimensions, draws the recorded box, and revokes the preview URL when closed. No image request, upload, OCR change or fact promotion occurs.
- Chrome/Playwright with the hash-verified Saffola photo passed at 390×844 and 1440×900. The line matched its preview, the box stayed inside the image, and preview opening created no HTTP or POST request. Axe violations, page errors and off-loopback requests were zero. The original run remained at one usable nutrient row, so this is verification UX rather than an accuracy gain.
- Full suite passed (295 tests across 33 files) and typecheck passed. Gemini remained disabled.

## 2026-10-21 — make uncertainty follow-ups package-specific

- A real-photo browser review found that the follow-up “What remains uncertain?” returned a generic local fallback even though the package record contained parser rejections and unresolved product identity.
- The deterministic response now brings together uncertain/conflicting findings, rejected rows, identity gaps and missing ingredient/allergen records, with raw OCR excerpts and observation IDs where retained. It explains that parser rejection is not proof that the printed information is absent and keeps recognition unverified.
- Offline cases cover conflicting values, a rejected bounded row and a clean record. Fresh Chrome/Playwright with the same development-only Saffola photograph passed at 390×844 and 1440×900: 22 OCR observations, 16 exported raw lines, 95 word boxes, one usable nutrient row, and successful uncertainty follow-up, correction and 50 g calculation. Axe violations, page errors and off-loopback requests were zero. This is integration evidence for one photo, not an OCR accuracy result.
- Full suite passed (295 tests across 33 files), typecheck passed. Gemini remained disabled; no provider call occurred.

## 2026-10-21 — link tentative candidates to recognized OCR words

- The audit found that text assist already carries ordered OCR lines, line/word geometry and uncalibrated recognition scores, capture settings and session image IDs, plus parser rejected/conflicting candidates and retrieved evidence. It omits image bytes; the package has no durable image digest. Image inspection remains a separate action.
- Added role-tagged OCR word references to the tentative-candidate contract. For every tokenized OCR line cited by a candidate, validation now requires an in-range word-index reference on that exact original line and rejects repeats within a role reference. Line text spans remain required, and candidates without word metadata retain legacy compatibility. Suggestions still remain tentative and cannot alter package facts.
- Confirmed the response boundary already allows both direct quotes and labeled synthesis, with exact citation spans and separate user-context handling; those structural checks do not prove entailment. No Gemini request was made.
- Offline assist tests passed (13), full suite passed (292 tests across 33 files), and typecheck passed. No browser/API route or OCR accuracy run was performed.

## 2026-10-21 — connect retrieved research records to future synthesis

- Inspection found that the consented assist request contained the deterministic audit sources but omitted local semantic-search results and source-search cards already visible in the same investigation.
- Added a small evidence-context adapter that merges those three existing inputs, deduplicates IDs, caps total sources and summary lengths, keeps the search classification citeable, and uses an explicit unknown jurisdiction. It rejects invalid/non-HTTPS URLs before request assembly. The server retains its own URL check.
- Updated the consent disclosure and provider instructions: source-search results are included only with the user's separate Gemini consent, treated as discovery candidates, and must retain their stated limits. Gemini remains disabled.
- Offline tests validate context construction and a synthetic literature paraphrase linked to exact source spans. The full suite passed 292 tests across 33 files and typecheck passed. No live model call, browser API route, retrieval relevance claim or entailment result was produced.

## 2026-10-21 — retain word-level OCR evidence through the product flow

- The audit confirmed existing assist readiness for ordered raw lines, line confidence and geometry, capture settings, parser rejection/conflict provenance, retrieved evidence, tentative structured candidates and labeled conversational synthesis. Gemini is still disabled; this was a local contract review only.
- Added per-word OCR text, word order, engine confidence and prepared-image boxes to the existing raw-line observation. Strict package checks bind those boxes to the matching capture; the text parser and confirmed nutrient records are unchanged.
- Offline tests checked token preservation through assist parsing, geometry bounds, and duplicate word-index rejection. Full suite: 289 tests across 32 files; typecheck passed.
- Fresh Chrome/Playwright used the existing loopback app and known development-only Saffola image at 390×844 and 1440×900. Its in-memory JSON export retained 16 OCR lines and 95 word boxes per run, all within capture bounds. One nutrient row remained parsed, matching prior evidence. Axe violations, page errors, off-loopback requests and provider calls were zero. This proves payload integration, not accuracy.
- Export was inspected in memory; no source photo or raw export was written into the tracked repository. The existing private image stayed under ignored evidence storage.

## 2026-10-21 — close raw OCR provenance and synthesis contract gaps

- Audited the assist payload and confirmed that current browser reads retain each OCR line's text, confidence, block/paragraph/line order, prepared-image bounding box, capture settings, image ID, parser decisions/candidate values, and retrieved evidence/calculations. The text-assist request includes this structured record and session image handles; it excludes photo bytes. Image/crop transmission remains a separate consented action.
- Tightened consented assist-input validation so records explicitly marked `ocr-line` cannot cross the boundary without their OCR origin, image link or reading order. Existing cross-record validation ensures the order maps to the image's capture record; standalone parsing remains tolerant of legacy/text-only lines. Added an offline test that combines an OCR observation with locally retrieved WHO food guidance in a bounded synthesis, while retaining exact-span citations and an explicit non-entailment label.
- Reconciled `docs/INTEGRATIONS.md`: the actual response boundary supports both direct quotation and cautious synthesis, rebuilds output from validated claims, and does not claim citation matching proves entailment. Gemini remains disabled. Synthetic tests do not establish provider compatibility, photo accuracy or model safety.

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

## 2026-10-21 — cite user context in future evidence-grounded synthesis

- Added exact-span citations for nonempty user-declared profile fields, so a future grounded paraphrase can explain relevance without representing profile text as verified health evidence.
- Offline assist-contract checks confirm OCR text, order, geometry, confidence, capture metadata, image linkage, and parser conflicts survive request validation; profile claims need exact context spans, while tentative candidates remain tied to OCR lines and retrieved sources.
- Typecheck and 279 tests across 31 files passed. Gemini remains disabled; no provider request, photo accuracy claim, browser integration or production build is claimed for this contract change.

## 2026-10-21 — add WHO free-sugars guidance to the working evidence path

- Added an original short source record for WHO's sugars guideline and explicit scope limits; connected the new record to deterministic audit references and local MiniLM retrieval without equating package total sugars with whole-diet free sugars.
- Rebuilt the index from the already-cached local model. On 18 developer-authored queries, hybrid Top-1 and Recall@3 were 18/18; all 12 boundary probes matched expected behavior. These are development measurements, not independent retrieval validation.
- Chrome/Playwright checked source attribution, guideline summary and scope at 390×844 and 1440×900. Six local route responses were HTTP 200; unrelated/current-law queries abstained, with zero Axe violations, page errors or off-loopback browser requests. No OCR/photo or Gemini behavior was tested.
- The full suite passed 280 tests across 31 files; TypeScript typecheck and `git diff --check` passed. No optimized build or provider call was performed.

## 2026-10-21 — verify OCR provenance at the assist boundary

- Kept the existing OCR evidence path: raw lines, confidence, order, geometry, engine/capture settings, and parser rejections/conflicts accompany the consented text request. Matching live handles now have to agree with the capture side and original dimensions; text-only/restored scans do not need a live photo.
- Confirmed cautious synthesis was already supported with exact source spans, profile context, tentative structured candidates and a non-entailment disclosure. No candidate is promoted into package facts. Original/cropped image transfer remains a separate explicit choice.
- The focused contract suite (10 tests), full suite (284 tests across 31 files), and TypeScript typecheck passed. Gemini was not called; no real-photo OCR measurement changed.

## 2026-10-21 — continue capture from an unresolved label result

- Added a conditional result-side action for an unidentified package or missing ingredients. It scrolls to the existing local photo input and opens the multi-file picker; it does not submit or send an image.
- Chrome on the same hash-verified Saffola photo confirmed the action at 390×844 and 1440×900. We canceled the picker, so no added-photo OCR result is claimed. The core run still yielded 22 line observations and one usable nutrient row, with zero Axe violations, page errors, off-loopback requests or provider calls.
- The full test suite (284 tests across 31 files) and typecheck passed. No OCR accuracy score changed.

## 2026-10-21 — expose candidate value and basis evidence separately

- Audited the existing assist payload: it already carries every recognized OCR line, reading order and geometry, confidence, engine/capture settings, parser rejection/conflict candidates, and session image-handle linkage. It has line geometry rather than table cells, and no durable image digest; no images or hashes were added to remote requests.
- Added diagnostic links from candidate numeric readings and bases to their separate original OCR line observations, preserving those links through incremental evidence merges. Made `direct-quote`/`synthesis` an explicit required output mode and instructed future synthesis to answer conversationally while retaining exact-span checks and the current safety limits.
- The full suite passed (284 tests across 31 files), TypeScript typecheck and `git diff --check`. The full suite initially found a missing ID remap in incremental merge; fixed the remap and added a regression. No real photo, browser UI, Gemini/provider call or OCR score was part of this checkpoint.

## 2026-10-21 — prepare explicit follow-up context for future Gemini assist

- Added a separate unchecked control for including no more than four recent local Q/A turns in a consented assist request. Client shaping and strict server validation bound text lengths; prior replies may resolve references but are excluded from the evidence/citation contract.
- Installed-Chrome acceptance at 390×844 and 1440×900 recorded the default-off state and toggle, with zero provider calls, Axe violations, page errors or off-loopback requests. This is consent/UI evidence only. Focused offline tests and TypeScript validation pass; Gemini remains disabled and no model-backed behavior is claimed.

## 2026-10-21 — return every requested label nutrient in the local answer

- Fixed the local nutrient response to collect all requested numeric fields, including calories as energy, and to say when any requested field is unknown. Existing calculation and observation provenance remains attached; safety-specific response branches were left intact.
- The full suite passed 288 tests across 32 files and TypeScript typecheck passed. Chrome/Playwright verified the three-field answer from synthetic typed label text on phone and desktop, with zero Axe violations, page errors, provider calls or off-loopback requests. This does not change the real-photo OCR score or establish live Gemini behavior.

## 2026-10-21 — add local additive identities and recheck OCR-to-assist continuity

- Added four original short FAO/WHO identity summaries and deterministic aliases for INS 102, 202, 211 and 385. Regenerated the local MiniLM index from cached model files; the 18 developer-authored rankings were unchanged at lexical 17/18 Top-1, MiniLM 17/18 and hybrid 18/18 with 18/18 Recall@3. No product-presence, legal-status or safety conclusion was added.
- The requested OCR/assist audit found no missing raw-text handoff in the current consented text contract: noisy lines, order, geometry, confidence, capture metadata, rejected/conflicting parser candidates and matching session image handles are preserved. Candidate values remain tentative and span-linked; image bytes remain a separate explicit step. The existing synthesis mode already supports cited conversational and profile-specific explanations. Gemini stayed disabled.
- Chrome/Playwright checked the typed additive-name follow-up and INS 211 JECFA source, WHO guidance and conservative abstentions at 390×844 and 1440×900. Twelve local evidence requests returned HTTP 200; Axe violations, page errors and off-loopback requests were zero. No provider call, real-photo accuracy result, held-out retrieval result or live candidate quality is claimed.
- A controlled offline contract case paired a noisy ingredient entity with its retrieved official synonym record and confirmed the candidate stayed tentative and evidence-linked. The focused assist contract suite passed 15 tests; the full suite passed 298 tests across 33 files and TypeScript typecheck passed.

## 2026-10-21 — measure real-photo field coverage during the full product journey

- Chrome/Playwright re-ran the hash-verified development Saffola photo at 390×844 and 1440×900. Both exports contained 22 observations, 16 raw OCR lines, 95 word boxes and one usable nutrient row. Against nine values from a single human visual read, the export had one exact numeric/unit/basis match, zero incorrect fields, five omitted fields and three withheld fields. This is one development image, not independently adjudicated or population-level accuracy.
- The result surfaced low structured-field coverage without changing the OCR engine. It does not establish which OCR stage caused each omitted/withheld field; prior stage association evidence remains heuristic. Raw OCR and rejected/conflicting parser candidates remain available for future tentative, source-linked interpretation.
- Per-field diagnostics showed three distinct rejected paths: energy's number and unit failed while a per-100 g basis candidate matched; fat contained two numeric candidates including the annotated value but no unit; sodium's unit and basis matched while its numeric candidate was rejected as invalid. Five additional annotated fields had no parser diagnostic/candidate, so their failures cannot be assigned to detection, recognition, row association or label matching. A visible header line had 22% uncalibrated OCR confidence. No OCR engine was changed.
- The local OCR-region inspection made no HTTP request. The browser receipt observed zero `/api/assist` or `/api/vision` requests, zero Axe violations, no page errors and no off-loopback requests. Correction, calculation, uncertainty follow-up and a separate add-photo recovery path remained usable. Gemini remained disabled; route instrumentation does not measure downstream provider cost. Screenshots are ignored private evidence; only the sanitized receipt is tracked.
