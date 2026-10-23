# Chronological decisions

## 23 October 2026 — ingest structured U.S. composition sources without loading every nutrient into memory

- Import USDA Foundation Foods April 2026 and FNDDS 2021–2023 from their official downloadable JSON, pinning the source hashes and validating record/nutrient counts. Keep source and generated records in ignored local `.data/`; retain attribution and CC0 terms in the committed provenance register. The importers count malformed/missing data instead of replacing it with zero.
- Store a compact food-name catalog plus checksum-verified seekable JSONL records. Search ranks only food metadata, then reads full nutrient data for the matched record. Three cold-process lookups sampled +21.6 MB RSS and 167 ms total; parsing the earlier full-object snapshots sampled +376.2 MB. Do not claim production memory capacity from this local measurement.
- Add FNDDS only as a clearly labeled U.S. dietary-survey reference. Its Indian-style food names (idli, roti) do not make it an Indian composition standard or recipe ground truth. Do not treat generic records or source portions as product facts or package servings.
- Let Gemini choose the local `search_food_composition` tool. When it omits a nutrient the user explicitly asked for despite the unique retrieved record containing it, deterministic code may add that exact returned row with its source span. It cannot select among multiple candidate foods or invent a missing nutrient. The parsed package, user profile and package photographs remain separate from these reference records.
- Verification used actual paid Gemini calls, the pinned local data, exact source evidence and no profile/photo data for the FNDDS query. One model response omitted protein; one later response returned it. Keep that variability in the record; the application coverage guard protects only this explicit structured-reference path, not general model-answer quality.
- Keep higher-reuse clinical and toxicology sources on a separate rights review. No unrestricted EFSA dataset transformation, restricted INDB/IFCT ingestion, current clinical target or Indian population accuracy claim is introduced here.

## 23 October 2026 — resume paid Gemini under the owner's revised budget

- The owner confirmed that exposed API keys were replaced and raised the project budget to ₹500. This supersedes the earlier four-call/$1 authorization and the temporary stop after HTTP 429. At the first checkpoint the local spend cap was $5; the current local guard is $4.20 with a 400-call ceiling, plus output and duration bounds. Keep the application on `gemini-3.8-flash` unless live compatibility evidence justifies a change. Never print credentials, prompts, image bytes, profile fields or model conversations.
- Live `/api/status` on isolated local port 3416 reports paid provider configured, authorized and enabled. Each consumer photo transfer still requires the app's explicit consent action; actual profile fields remain governed by the user's separate choice.
- At that early checkpoint, the local usage ledger estimated 64 paid requests, $0.6257445 actual and $1.311534 reserved; those figures are historical. The current ledger is recorded in `docs/STATUS.md`. Ledger amounts are estimates, not billing receipts.

## 23 October 2026 — keep OpenFoodTox 3.0 out of the derived corpus pending reuse review

- EFSA's official OpenFoodTox 3.0 page describes 7,880 substances, 45,682 study results and 19,452 toxicological reference values, with an Excel export and IUCLID archive. The Zenodo release metadata identifies CC BY-ND 4.0; EFSA states it owns the database and content.
- A local, ignored copy of the 22.6 MB Excel export was inspected for workbook structure only. Do not transform or distribute its rows as a NutriScan index until reuse rights for that purpose are established. Prefer source links and separately rights-reviewed summaries while continuing ingestion from sources whose permitted reuse is clearer.

## 23 October 2026 — OCR-only GTIN recovery remains an explicit candidate

- A checksum-valid number recognized in original image OCR can help an explicit product-record lookup, even if the browser barcode decoder misses the bars. A check digit alone does not prove the number belongs to the photographed package.
- Offer only a single, non-conflicting GTIN from raw OCR lines; exclude invalid checksums and license-labelled text. Preserve observation IDs and do not assign `PackageData.barcode`. Only a user-triggered lookup may send the number to Open Food Facts, with candidate status disclosed.
- Paid Gemini is locally selected but disabled pending credential replacement and Google project quota/billing confirmation. Keep provider calls off until those owner actions are complete.

## 23 October 2026 — stop paid Gemini retries after a quota rejection

- A single owner-authorized synthetic text request to paid `gemini-3.8-flash` returned HTTP 429. Do not retry within the four-call/$1 cap until the project's quota and billing status are checked. No package images or user context were transmitted; the actual charge is unknown because the provider returned no token receipt.

## 23 October 2026 — keep low-signal OCR out of the default evidence list

- Collapse short OCR fragments and isolated numeric tokens without units; keep number-plus-unit snippets visible. “Show all,” the full transcript, photo-region inspection and export retain access to the original observations. This display rule does not filter evidence sent to interpretation or promote OCR into package facts. It supersedes the earlier default visibility of numeric-only fragments.

## 23 October 2026 — report Gemini quota limits without leaking provider errors

- Map only a typed upstream HTTP 429 on Gemini routes to stable quota/rate-limit guidance. Do not serialize the SDK error message or body; those may contain prompt, image or credential data. Preserve the app's retry control and local analysis on this failure path.

## 22 October 2026 — keep package evidence out of the duplicate results dashboard

- In The Thread, keep the everyday package answer and nutrition controls in the conversation. The evidence drawer contains attributed sources and original observations only; product/source search and provider controls stay behind a separate disclosure.
- In the label-text view, tuck single-character non-numeric OCR scraps into a nested “short OCR fragments” disclosure. Preserve every observation in raw evidence and keep numeric-only readings visible; this is a presentation filter, not evidence deletion or OCR improvement.

## 22 October 2026 — expose community ingredient evidence without promoting it

- Render Open Food Facts ingredient text and allergen tags only inside a collapsed, attributed community-record disclosure after the user explicitly requests a product lookup. Keep these fields separate from photographed observations, confirmed package facts, calculations and exported package data; empty community fields do not establish absence on the package.
- The live India-tagged Saffola record contains a 453-character ingredient string and three allergen tags. Browser checks confirm those values display verbatim from the source, but the string has not been checked against the physical package and may contain errors. This is source-data access, not photo extraction or label verification.
- Move exact barcode and canonical record reads to Open Food Facts `/api/v3/product/{code}`. The official API documentation labels v2 deprecated and v3 current; candidate text search remains on Search-a-licious. Preserve the record link, retrieval/modified dates, market and variant caveats, and license attribution. Product images were not requested or reused.
- Mobile and desktop acceptance ran against the fresh isolated Next.js production build with only a typed barcode fixture; it verified one exact India-tagged record, source text disclosure, no promotion into package facts, no browser-side external requests, no Axe findings, no overflow and no page errors. Do not describe this as a photo-identity result. Full suite (1,235/125), TypeScript and the isolated optimized build pass.
- Sources: [Open Food Facts API documentation](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) and [official license guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/).

## 22 October 2026 — score Indian multi-column labels at each printed basis

- For the Bagrry's browser acceptance, count each nutrient at each printed basis as its own complete value-unit-basis field. This yields 14/16 exact matches (7/8 per 100 g and 7/8 per 35 g), with both saturated-fat readings withheld for cross-reader conflict. Do not interpret the corrected scoring scope as an OCR or parser gain; the photo is a single visual-read development sample.
- Keep the readable product outcome honest: a 35-g serving supports calculations for accepted readings, but the nutrition-only photo does not establish product identity or ingredients. Preserve all original OCR observations, including lines beyond the former 40-line collapsed view; the new expand control changes reviewability only.
- Continue India-first development across product categories. Treat French/Spanish examples as secondary regressions, evaluate English/Hindi only when rights-reviewed package photographs are available, and leave product-group held-out examples untouched.
- The acceptance exercised the browser application without image upload or Gemini calls. Saturated-fat conflicts remain excluded from calculations; the later manual correction is outside the automatic score. The source image's redistribution rights remain unverified.

## 22 October 2026 — prioritize Indian packages and preserve table-level value qualifiers

- Treat Indian packaged foods as the primary target. The current five-photo OCR matrix has two Indian examples, both oats; French/Spanish labels and Coca-Cola stay secondary regression examples. Do not tune on the familiar Nutella photos absent a broad regression reason. Current Indian category coverage is too narrow for a market-level claim, and no independently annotated English/Hindi package is available.
- Keep the authorized Table Transformer as a local structure reference, not the production reader. It predicted 14 rows/2 columns on Saffola and 17 rows/4 columns on Bagrry's; the latter visibly includes overlapping/extra left-column regions. There are no gold table boxes or text-cell mappings, and CPU peak RSS was 886 MB with a 115.4 MB checkpoint. These results do not establish structured-field accuracy or a feasible mobile deployment.
- Preserve the Saffola `(Approximate Values)` heading as a package qualifier. The parser now reports it in label notes and the uncertainty summary; portion calculations use the printed readings as estimates. This does not change extracted field counts. A fresh mobile/desktop run returned 6/9 exact, 0 incorrect, 1 omitted and 2 withheld before a separate manual-correction check.
- Official PP-OCRv5 includes a small Devanagari recognition model, and PaddleOCR.js supports custom ONNX model assets. Evaluate that route only on rights-reviewed English/Hindi package photos with value-unit-basis and ingredient labels; no Devanagari integration or accuracy result is claimed yet.
- Raise the local retrieval candidate floor from 0.30 to 0.40 after reproducing an unrelated NIDDK match at 0.3966 for the beta-glucan-in-oats question. Keep the floor explicitly uncalibrated; current developer probes retain all 21 authored ranking cases and meet 16/16 boundary expectations. Extract and exact-boost a single prefixed additive identifier inside natural-language questions, while leaving multiple identifiers to ordinary hybrid ranking. Chrome verified the resolved source and abstention at mobile and desktop sizes with no UI or request-boundary findings.
- Verification: 387 tests/41 files, TypeScript and the full local mobile/desktop Chrome journey pass. The acceptance showed no page errors, Axe findings, off-loopback requests or Gemini routes. The qualifier change is a transparency fix, not an OCR gain; no optimized build was run while the local dev server was active.

## 22 October 2026 — recognize localized package-basis prepositions

- Extend the shared parser's nutrition-basis vocabulary to include French `par` and Spanish `por`, including geometry tokenization and parser-only removal so basis text is not mistaken for a nutrient value. This is a narrow language-coverage fix, not an OCR-engine or routing change.
- Add focused French/Spanish text cases; module tests, full suite and TypeScript pass. A targeted real-photo rerun was stopped while Chrome used about 2 GB of working memory, before the benchmark emitted a receipt. Treat photo accuracy impact as unmeasured and do not include it in the V6 row-reconstruction result.

## 22 October 2026 — reconstruct curved nutrition tables and promote selective PP-OCRv6

- Keep Tesseract as the quick first pass and retain PP-OCRv5 as the frozen comparison baseline. Use the official browser SDK’s PP-OCRv6-small for the selective second pass: on the same five already-used development photos / 37 fields, PP-OCRv5 with the production parser scored 5 correct, 0 incorrect, 23 omitted and 9 withheld; PP-OCRv6 before row reconstruction scored 7/5/21/4; PP-OCRv6 with reconstruction scored 13/0/20/4. The eight exact-field gain is concentrated on the two oat photos; three other packages still yield zero exact fields.
- The parser now uses independent vertical order from all left-side text rows and each declared numeric column when the panel has one clear multi-basis header, unambiguous geometry and complete matching row counts. It reconstructs only recognized nutrient rows as tentative OCR candidates, preserves original OCR lines and source geometry, and leaves missing cells and cross-reader conflicts withheld. No inferred values overwrite the evidence ledger.
- The real mobile application now uses this path. Chrome/Playwright on the same two oat photos scored 12/17 exact fields combined, 0 incorrect, 4 omitted and 1 withheld; the withheld Bagrry’s saturated-fat disagreement stays unresolved. All 12 accepted fields calculated without manual correction. Desktop Chrome reproduced Bagrry’s at 7/8. Mobile scan times were 27.8 s and 27.0 s; the fallback remains selective.
- Runtime cost is material: the comparative one-thread WASM harness averaged 27.7 s per PP-OCRv6 photo. V6 model files total about 31.2 MB, beside 28.4 MB of WASM and a 10.9 MB harness bundle. JS heap samples exclude WASM/native memory; a single Chrome process sample near 2.3 GB came from the sequential multi-model/language run and cannot be attributed to one model or projected to mobile. Mobile-device performance remains unmeasured.
- The experiment used previously explored development products, not a locked evaluation split. Keep these numbers exploratory, acquire independent annotations before a population claim, and continue work on the three failed non-oat labels. Only model-host GETs occurred in the benchmark; package photos stayed local. Gemini remains disabled.
- Verification: 378 tests across 41 files, TypeScript, optimized build, and real mobile/desktop Chrome acceptance passed. Receipts: `docs/evidence/ocr-rank-reconstruction-development.json`, `ocr-rank-reconstruction-browser.json`, and `ocr-rank-reconstruction-desktop-browser.json`.
## 22 October 2026 — integrate a selective PP-OCRv5 reader and preserve uncertainty

- Keep Tesseract as the fast first pass and regression baseline. Add the official `@paddleocr/paddleocr-js` PP-OCRv5 English browser SDK as a lazy, selective second pass, retaining its word boxes/confidence and photo provenance in the existing OCR observation contract. It reuses the existing parser and evidence merge; exact same-photo OCR agreement plus an explicit secondary basis can resolve a primary unbased reading, while conflicts remain withheld. The browser fallback does not replace the primary reader.
- The same 5-photo/37-field development set scored 1/37 complete exact fields for Tesseract-only versus 6/37 for the integrated flow, with no incorrect complete fields. The gain is mostly Saffola; three other packaging examples had zero exact fields. Do not treat 16.2% as a population estimate or claim the product meets the intended broad-recovery target.
- Integration cost is material: the first cold scan took 30.96 seconds and about 60.9 MB of unique first-load model/runtime/bundle assets; the next four scans averaged 14.6 seconds versus 8.6 seconds for Tesseract-only. The cold model archive requests were GET-only and photos remained client-side. Memory and mobile-device performance are unmeasured. Gemini and remote image inspection remain disabled.
- PP-StructureV3 is a legitimate next table-structure candidate, but its official pipeline composes detection/OCR/table modules and lists optional table weights such as 351 MB for SLANeXt wired structure and 124 MB for RT-DETR-L wired cell detection; no packaged-food accuracy or browser feasibility was established. Do not download/integrate these models on model size alone. Microsoft's Table Transformer is archived, requires OCR as separate input, and its published pre-trained weights are PubTables-1M/FinTabNet-oriented at 110 MB per model; it is not an OCR replacement. The South African food-label study evaluates text OCR metrics/coverage/time on packaging, but does not establish exact nutrient-value/unit/basis performance for NutriScan. The Mendeley Food Packaging OCR Dataset v2 advertises text detection/recognition annotations and CC BY 4.0; it has not been downloaded or assessed for a non-tuning evaluation split.
- The next extraction milestone should target the failed language/table layouts and independent product-group annotations, not further Tesseract parameter sweeps. The observed French/Spanish nutrition headings that leaked into identity were blocked as name candidates; the patch is unit-tested but needs browser recheck. Preserve the five-photo browser receipt and the non-relevant beta-glucan retrieval result as separate evidence classes.
- Sources reviewed: [PP-StructureV3 pipeline and model sizes](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PP-StructureV3.html), [Microsoft Table Transformer implementation and model cards](https://github.com/microsoft/table-transformer), [food-packaging OCR study](https://arxiv.org/abs/2510.03570), and [Food Packaging OCR Dataset v2 terms and scope](https://data.mendeley.com/datasets/3cpx2fmn3r/2).

## 22 October 2026 — diagnose the real-photo OCR pipeline without promoting an engine

- Retain browser-first OCR and the current production reader. On the same hash-verified development photo, Chrome retained 16 line boxes / 95 word boxes and produced 1/9 exact fields, 0 incorrect, 5 omitted and 3 withheld in both viewports. Viewport repeats are not new samples.
- Report detector and table-structure performance as unmeasured until independent region/row/column annotations exist. Available field candidates show exact numeric/unit/basis values for 2/9, 2/9 and 4/9 fields; three of four diagnosed parser fields were rejected, with missing unit, multiple values and invalid value reasons. Five omissions have no parser diagnostic and remain stage-ambiguous.
- Do not interpret candidate counts as isolated OCR recognition accuracy or use this one image to select a replacement. Extend the existing annotation set before comparing stage-level accuracy. The current receipt stays sanitized; raw OCR and screenshots remain ignored/private.
- Make calculation assumptions explicit that label readings and bases are unverified, including corrected readings. Keep the calculation available with its source lineage; a user correction does not become independent package verification.
- Surface that same unverified status in the prominent “What matters” summary so users do not need to expand calculation details to see the evidence limitation.

## 22 October 2026 — keep the private remote empty pending image-rights review

- The authenticated GitHub account matched the requested owner and the target repository did not exist. Under the owner's explicit authorization, create one private repository and add it as `origin`; verify GitHub reports private visibility. Leave it empty until the reachable project history clears review.
- Audit 144 reachable commits (1,991 Git objects; 1,067 reachable blobs under 10 MB), the current tracked tree and ignore rules. No high-confidence key/token patterns, private-key material, credential files, academic documents, archives, model caches or generated dependency/build artifacts were found; the inspected evidence screenshots show product/UI content and synthetic flows, not a real user profile. The only credential-shaped text is an intentionally invalid URL in a URL-rejection unit test; `.env.example` contains empty provider settings. The ignored owner handoff and original-photo directory remain outside Git.
- The complete tracked image history contains 25 UI/evidence images. `docs/evidence/02-genuine-photo-selection.jpg` embeds package photographs; related source records identify Open Food Facts imagery but mark image-specific redistribution review pending, and `docs/DATA_PROVENANCE.md` says not to redistribute before checking the exact source terms and attribution. Treat this as a licensing blocker even for the requested private upload.
- Do not push or rewrite history and do not remove the evidence silently. Resume history publication after the owner either provides rights/attribution clearance for the exact embedded images or explicitly approves a history rewrite that removes or replaces them, followed by a fresh audit. The original 144 audited commits remain intact; sanitized documentation-only commits were appended locally after the audit.

## 22 October 2026 — finish the local OCR reference-adjudication path and strengthen OCR evidence links

- Keep the current blind browser annotation pass and add a bounded offline adjudication command, rather than changing the PWA or OCR engine. It requires two distinct passes for the same image, source/license metadata and language; each source field must be explicitly mapped exactly once.
- Require the reviewer to choose a reader, enter an explicit adjudicated field, or withhold the value as ambiguous/not visible. Unresolved numeric text, normalized value, operator, unit and basis must stay null. Preserve byte-exact pass SHA-256 digests, source field links, decision rationale and region-ID mappings in the canonical record.
- Compute the descriptive seven-dimension reader agreement only over fields explicitly paired by ID. Report region bounding-box overlap separately for the paired label/value/row/unit/basis regions. Neither metric establishes OCR accuracy or reference truth.
- Added a local browser adjudication route that verifies both byte-exact pass hashes and the original image fingerprint, displays source regions, requires explicit mappings/rationales and exports the existing strict contract. Synthetic Chrome acceptance at 390×844 and 1440×1000 retained both pass digests and field lineage; an unresolved numeric conflict exported with digits, value, unit and basis null. Axe violations, page errors, off-origin requests and POST requests were zero. This is UI/contract evidence, not a real human annotation.
- Tightened tentative OCR-candidate validation so each referenced OCR word index is in range and in order, and its recognized text appears in an exact quoted span from the same OCR line. Fuzzy normalized candidates remain allowed and tentative. The audit confirmed that the text-assist payload preserves ordered OCR lines, word text/confidence/geometry, capture/processing provenance, parser rejection/conflict candidates, retrieved sources and separate tentative candidates. The current synthesis boundary is not quote-only: it supports labeled synthesis and profile references with exact evidence spans, while citations still do not prove entailment. Image bytes remain behind separate explicit inspection consent; durable image identity is session-scoped, with no stable source-image digest in saved package observations.
- Offline tests cover a manually resolved value, an unresolved disagreement, missing/reused field links, image/source mismatch, provenance rejection and invalid word-to-span links. The 350-test suite, typecheck and optimized build passed. No real double-read photo was processed, so the 1/9 development Saffola result and held-out status did not change. Gemini remains disabled.

## 22 October 2026 — connect unsupported follow-ups to the local evidence index

- Keep package-specific questions on the deterministic package audit. When its trace marks a question unsupported from the package alone, search the existing curated MiniLM index through the local /api/evidence route using only the bounded question text; do not add profile fields or photos to that request.
- Validate the shared retrieval response and each HTTPS source URL before attaching at most three citation records to the relevant conversation turn. Show the top source summary, publisher, jurisdiction, publication/retrieval dates and limitations; collapse additional candidates. Label matches as discovery candidates, not verdicts. A no-match remains an explicit statement about this index and development floor, not proof that no evidence exists.
- Preserve the opt-in boundary: cited sources can be stored with a conversation only under the existing local-save choice, and prior conversation citations enter Gemini evidence only when the user separately includes conversation context. The current assist response already permits labeled synthesis; exact supporting spans and safety validation remain. Gemini stays disabled.
- Chrome/Playwright tested a synthetic typed-label journey at 390×844 and 1440×900. An otherwise unsupported meal-planning question surfaced the NIDDK summary with US scope and its no-personalized-plan limitation; an unrelated question abstained. Four local route responses returned 200; no non-loopback, assist or vision requests, page errors or Axe violations occurred. This is not independent retrieval-relevance, clinical, OCR-photo or model evidence. Receipt: docs/evidence/conversational-evidence-browser.json.

## 22 October 2026 — correct OCR browser scorer display-label aliases

- The previous browser scorer looked for “Fat” and “Fiber,” while the result table renders “Total fat” and “Fibre.” Update only the evaluator labels and rerun the same 14 Chrome cases on the same two hash-verified development photos; keep the OCR engine, parsing policy and images unchanged.
- Counts changed from 2 correct, 2 incorrect, 111 omitted and 3 withheld to 4 correct, 2 incorrect, 105 omitted and 7 withheld across 118 repeated field-case comparisons. Two repeated Saffola fat readings became exact matches; four rows previously counted as omitted are now correctly withheld because no comparable basis was established. The two exact Saffola fields recur across image conditions, so these are not four independent sample outcomes. Axe violations and page errors remained zero.
- Keep the corrected receipt and update current summaries. Treat this as evaluation accounting correction, not OCR improvement or population accuracy. No reader, parser or architecture change is justified by this replay.

## 22 October 2026 — verify corrected photo readings by preserving OCR source IDs

- A correction creates a new user-originated observation, so acceptance must not require the total observation count to remain constant. Check instead that each OCR-line observation ID present in the pre-correction export still appears in the evidence ledger after correction.
- Re-run the hash-verified development Saffola photo at 390×844 and 1440×900. All 16 original OCR-line IDs remained visible; the new correction stayed linked, and the 50 g calculation remained 1.7 g.
- The same single-reader reference still yielded 1/9 exact fields, 0 incorrect, 5 omitted and 3 withheld. This revalidates the current product journey and provenance; it does not improve OCR or add an independent sample. The check and receipt are `scripts/audit-core-journey.mts` and `docs/evidence/core-journey-audit.json`.

## 22 October 2026 — explain dated FSSAI nutrient-content claim wording locally

- Add a deterministic explanation for recorded high/rich-protein, high/rich-fibre and low-sugars wording, grounded in FSSAI's Version IV Advertising and Claims compendium and dated amendment index. Keep matching package lines as unverified observations. Do not infer an RDA/reference group, classify a product as solid or liquid, choose a serving basis, calculate claim eligibility or make a current-law finding.
- Keep the source records concise and attributed; terms for downstream redistribution were not independently reviewed. Current applicability and product compliance remain unresolved and must route to current official research.
- Refresh the local 20-source index from cached MiniLM assets. The 19 developer-authored queries score lexical 18/19 Top-1 and 18/19 Recall@3, MiniLM 17/19 and 19/19, and hybrid 19/19 on both. The new high-protein query ranks its declared source first for all methods; the prior 18-query hybrid set remains 18/18. The 13-case boundary diagnostic remains 13/13. These are development-only retrieval results.
- Chrome/Playwright acceptance of synthetic typed label text passed at 390×844 and 1440×900. Criteria, source cards, unverified line wording and current-law abstention were verified; Axe violations, page errors, off-origin requests and assist/vision routes were zero. Full suite: 342 tests across 36 files; TypeScript passed. No real-photo OCR score or Gemini behavior changed; Gemini remains disabled.

## 22 October 2026 — preserve unparsed label lines and explain trans-fat evidence

- Keep the existing OCR record and consent boundary. The text-entry parser now also represents otherwise-unparsed user-entered label lines as bounded `raw-text-line` observations, retaining repeated lines and their order in the observation array. Keep them unverified and leave raw text unchanged.
- Add concise deterministic trans-fat context from the WHO fact sheet and the dated 2021 FSSAI Gazette amendment. Link literal OCR/user lines when present, but do not create a trans-fat nutrient, amount, portion calculation, current-law conclusion or compliance finding. Current legal questions still require live official research.
- Regenerate the 18-source local index from cached model files. The same 18 developer-authored ranking cases retain their hybrid and semantic metrics; lexical MRR fell from 0.9556 to 0.9444 because one relevant source moved from rank 5 to 7 inside a zero-score tie. Keep this disclosed as development evidence, not held-out relevance.
- A synthetic typed-label follow-up passed at phone and desktop sizes with both source cards visible, no structured trans-fat nutrient, no accessibility violations, page errors, external requests or Gemini routes. Full suite and typecheck passed. This validates the local product flow, not photograph accuracy, current law or model behavior.

## 21 October 2026 — link user corrections to original OCR evidence

- Keep the existing OCR-to-assist contract. It already preserves raw line order, word recognition metadata and geometry, capture/image-handle provenance, parser candidates and rejection/conflict reasons, retrieved evidence, and separate tentative structured candidates. Keep image bytes behind the existing explicit inspection consent. The response boundary already supports evidence-linked synthesis, including user-context references; exact spans provide traceability, not entailment.
- Add optional bounded `supersedesObservationIds` for user-originated corrections. Validate that links are unique and refer to existing, different observations; retain the linked OCR rows and parser diagnostics, keep the nutrient pointed at the user correction, and remap links when package evidence is merged. Render the correction and its prior source-line excerpts in the evidence ledger.
- Offline contract tests cover conflicting readings, schema errors and assist-boundary preservation. Chrome/Playwright on one hash-verified development photo confirmed 16 raw OCR lines remain and the correction links four prior observations at 390×844 and 1440×900; the 50 g calculation remains 1.7 g. This measures correction provenance and workflow only. OCR accuracy did not change, and Gemini remains disabled.

## 21 October 2026 — preserve multi-photo OCR evidence within a bounded assist request

- Keep the existing observation-to-assist contract: complete raw OCR lines, ordered word boxes/confidence, capture metadata, parser candidates, evidence sources and tentative candidate links already cross validation. Keep labeled synthesis with exact evidence spans; traceability is not entailment. Gemini remains disabled.
- The client and server now clear duplicate `package.rawText` only when every non-empty text line matches the ordered raw OCR observations; mixed or unmatched text stays intact. A 10-photo offline fixture retained 160 raw lines, all word metadata, captures and parser diagnostics in a 253,902-byte request, under a 300 KB hard cap. Over-limit requests are rejected whole. This is a transport-contract result, not real-photo or provider evidence.
- The official INDB portal offers a workbook describing 1,014 recipes, but the reviewed portal/repository materials did not establish dataset redistribution terms and the repository README says IFCT source tables must be requested from ICMR-NIN. Do not ingest those values until permissions for the workbook and its inputs are clear; record the owner action in `OWNER_ACTIONS.md`.
- Full offline suite: 323 tests across 33 files; TypeScript typecheck passed. No OCR accuracy measurement, browser/provider call, or semantic-index change was made.

## 21 October 2026 — explain precautionary allergen label wording without making a safety finding

- Use FSSAI's dated Labelling and Display Regulation 5(14) and FAQ Q29 to distinguish a separate “Contains” declaration for specified allergenic ingredients from “May Contains” wording about cross-contamination. The FAQ also gives similar-meaning examples such as “May contain traces” and shared-facility wording. Sources: [original Gazette notification](https://www.fssai.gov.in/upload/notifications/2020/12/5fd87c6a0f6adGazette_Notification_Labelling_Display_14_12_2020.pdf), [FSSAI FAQ](https://www.fssai.gov.in/upload/uploadfiles/files/FAQ_Labelling_Display_01_11_2023.pdf).
- Treat this as an explanation of wording only. It establishes neither actual allergen presence, amount or exposure, individual risk or safety, nor compliance of an exact package. Route current compliance questions to live official research using the exact product and jurisdiction; static sources remain dated context.
- Re-audit confirmed the existing consented assist contract already retains ordered OCR lines, word/layout recognition evidence, capture and session image provenance, parser rejection/conflict candidates, retrieval evidence and tentative candidates. Exact-span citations and profile-aware synthesis remain available under the existing safety boundary. No contract redesign or provider call was warranted.
- Regenerate the existing local MiniLM index when curated sources change. The 18 unchanged developer-authored ranking cases now score 17/18 Top-1 and 17/18 Recall@3 for lexical BM25, 16/18 and 18/18 for MiniLM, and 18/18 for hybrid; the expanded corpus lowered two single-method metrics while hybrid stayed level. A separate 13-case boundary diagnostic passed, and the same-origin evidence API returned the FSSAI FAQ first for a wording question. These small developer probes do not establish independent relevance.
- Deterministic retrieval and offline tests cover the local explanation and live-law abstention. The 314-test suite, typecheck, optimized build and synthetic Chrome/Playwright flow passed at phone and desktop sizes. This is not photographed-label accuracy or Gemini evidence; Gemini remains disabled.

## 21 October 2026 — answer age-group follow-ups from local whole-diet guidance

- When a short children/adults follow-up directly follows a WHO dietary-fibre guidance question, resolve the reference from the preceding user question alone. Do not use the previous assistant response as evidence or silently send prior turns to Gemini.
- Use the existing WHO source summary for the child age bands (15 g/day at ages 2–5, 21 g/day at ages 6–9, 25 g/day at ages 10+). Keep them population whole-diet guidance; any package portion calculation remains conditional on the observed label reading.
- No OCR or assist schema change is needed: the current consented assist input already retains raw OCR observations, recognition metadata, parser diagnostics, capture provenance and tentative candidates, and its response boundary already supports citation-linked synthesis. Offline contract checks remain distinct from live Gemini behavior.
- The 312-test suite, typecheck, optimized build and synthetic typed-label Chrome flow passed at phone and desktop viewports; the run made no provider calls. This improves local conversational continuity only and establishes no photographed-label accuracy or model quality.

## 21 October 2026 — route whole-diet carbohydrate guidance without changing package quantities

- Route only clear guidance questions about fibre/fiber quality, whole grains, pulses/legumes or carbohydrate quality to the existing WHO source. Keep direct package/portion amount questions on the local nutrient calculation path.
- Answer from the curated source summary: recommend carbohydrate sources from whole grains, vegetables, fruits and pulses; for fibre questions state the adult naturally occurring-fibre recommendation and that child guidance is age-specific. Keep a package calculation such as 2.4 g in 30 g from 8 g/100 g explicitly conditional on the label reading and separate from whole-day intake. Do not invent a pulse serving amount or individual prescription.
- No new corpus source is introduced. The 308-test suite, production build and Chrome/Playwright synthetic text flow pass at phone and desktop sizes; the source card is visible and no provider or off-origin call occurs. This is not photographed-label or model evidence.

## 21 October 2026 — surface noisy additive readings as tentative evidence

- Use a bounded multi-token OCR typo match only to produce a tentative additive-identity candidate when at least two exact token anchors and a source-backed registry identity support it. In the local audit, inspect at most 32 complete raw OCR lines of at most 160 characters and require at least 80% line-token coverage.
- Preserve the original OCR observation and source link in an `uncertain` finding. Never add the candidate to confirmed package additives, nutrient values or calculations. Keep the existing assist candidate schema and exact citation spans; no schema rewrite is needed.
- This improves one controlled noisy-name path only. It does not improve numeric OCR, parse a nutrient table, verify ingredient presence, establish model quality or change the production OCR reader. Gemini remains disabled.

## 21 October 2026 — keep OCR capture identity open to bounded reader names

- Let the existing capture record carry a bounded reader identifier rather than requiring the production `tesseract.js` literal. Keep the current browser reader, normalized `0-100` confidence contract and processing fields unchanged.
- This is a provenance-contract allowance for future reader comparisons and assist requests; it does not integrate or benchmark another OCR engine, select a replacement, or change production OCR.
- Offline validation confirms an alternate identifier survives the package-to-assist boundary and rejects an overlong identifier. No live Gemini request or OCR-accuracy claim is made.

## 21 October 2026 — let users inspect OCR lines in the local source image

- Add an explicit **Inspect photo region** action beside a raw OCR line only when its image, capture run and geometry are linked and the image remains in the current browser session.
- Rebuild the same prepared image using the capture's recorded preprocessing and crop, verify dimensions against the capture, and overlay the OCR bounding box. Keep the image browser-local; do not call a provider or retain the preview URL after the dialog closes.
- This is a visual aid for checking where the reader found text, not a confirmation that the reading is correct. Keep OCR observations and confidence metadata unchanged; text-only or restored records still expose their observations without offering a missing-photo preview.
- Real-photo Chrome acceptance verified the line, geometry and no-request behavior at mobile and desktop sizes. It did not measure accuracy or test a live provider.

## 21 October 2026 — answer package uncertainty questions from retained evidence

- Route explicit “what is unknown/uncertain?” follow-ups through the deterministic package audit. Summarize existing uncertain/conflicting findings, parser-rejected nutrition rows and identity or ingredient/allergen record gaps; retain original OCR line excerpts and observation IDs where present.
- Describe parser rejection as a local parsing decision, and state that missing text in the record does not prove absence from the printed package. Keep OCR unverified and do not promote tentative candidate interpretations into confirmed package facts.
- Use this as a useful local response path while Gemini is disabled. Keep exact-span citation checks and the existing direct-quote or labeled-synthesis boundary for any later consented model response; structural traceability does not establish entailment.
- Offline tests cover conflicting readings, a rejected bounded value and a clear extraction. Fresh Chrome/Playwright verified the real-photo follow-up at mobile and desktop sizes. This does not change OCR accuracy evidence or establish model behavior.

## 21 October 2026 — link tentative interpretation to OCR tokens

- Keep the complete raw OCR line, capture provenance, geometry, confidence metadata and parser candidates as the authoritative observations. Add optional role-tagged word-index references to tentative structured candidates so an inferred label, value, unit, basis or identity can point to the recognized tokens without duplicating or promoting them.
- When a cited OCR line has word metadata, require the tentative candidate to reference words from that line. Validate referenced line membership, image/order linkage through the package contract, in-range indexes without repeats inside a role reference, and the existing exact source-line quote. Invalid token links withhold the candidate.
- Preserve text-only/legacy OCR candidate compatibility. Do not make word scores calibrated confidence, infer missing basis, add image bytes or a durable image hash, change parsing, or alter the confirmed package record.
- Existing synthesis behavior is the intended conversational boundary: direct quotation or labeled evidence-linked interpretation with exact spans, citations and separate profile context. Structural checks do not prove entailment. Gemini remains disabled.

## 21 October 2026 — include shown search results in consented synthesis context

- Compose the existing deterministic audit references, local semantic-search references and user-requested research results already shown in the investigation into one source-ID namespace for future assist. Deduplicate by ID, keep the total at 15, bound each summary, and retain the search classification alongside the excerpt.
- Map search metadata into the existing strict source contract; state unknown jurisdiction rather than infer it. Drop invalid or non-HTTPS URLs before building the request, while retaining server-side URL validation.
- Treat research results as discovery candidates, preserve their limitations, and cite only exact text spans. This allows later synthesis to discuss retrieved literature or regulatory records without asserting search relevance as truth. Gemini remains disabled; no provider behavior is claimed.
- Offline tests cover source mapping, limits, URL rejection, and a synthetic research-result paraphrase with exact source spans. They do not measure relevance, entailment, or model output quality.

## 21 October 2026 — preserve word-level OCR evidence for future interpretation

- Keep Tesseract's recognized words, word order, engine-reported confidence and prepared-image bounding boxes nested on their original OCR line records. Preserve full line text unchanged for existing parser behavior and citation spans.
- Validate that word boxes remain inside the capture's recorded prepared-image dimensions and that word details only appear on ordered OCR lines. Continue to treat token confidence as recognition metadata, not factual certainty.
- Do not add a production table-cell structure: the current reader does not reconstruct cells. Do not retain image bytes or introduce a stable image hash in package records. A future provider can inspect the supplied raw lines, words, parser diagnostics and retrieved evidence; any image inspection remains a separate explicit consent step.
- Fresh Chrome/Playwright export of the known development-only Saffola photo retained 16 OCR lines and 95 word boxes at mobile and desktop sizes. This verifies the browser-to-export data path only; numeric extraction stayed at one parsed row, with no new accuracy claim. Gemini remained disabled.

## 21 October 2026 — preserve OCR provenance and support cautious synthesis

- Keep every captured OCR line in the package evidence ledger. Add explicit per-image reading order, source/prepared dimensions, coordinate space, Tesseract.js version/language/segmentation, and preprocessing settings so bounding boxes and confidence remain interpretable across crops and rotations.
- Require observations marked as raw `ocr-line` records to retain OCR origin, source image ID and reading order before they cross the consented assist boundary; package capture validation then requires that order to resolve to its capture record. Keep geometry optional in the general contract so a reader without coordinates can still preserve its text, while the current Tesseract path supplies line boxes.
- Record nutrient parser outcomes separately from raw text: accepted, conflicted or rejected candidates retain the attempted numeric tokens, units, basis candidates, reason codes and linked observations. A parser rejection does not discard the line, and a model proposal never changes the package record.
- Send the bounded evidence contract, optional user context, retrieved source records and deterministic local calculations through the existing consented assist route. Keep selectively inspectable photo handles in metadata; image bytes still require a separate explicit image-inspection action. Gemini remains disabled.
- Treat image provenance as session-scoped: OCR lines and capture metadata join on the current image handle, but the package does not retain source bytes or a durable content hash. Geometry is line-level; explicit table-cell regions remain an evaluation annotation, not production OCR output.
- Permit a claim to be direct quotation or cautious paraphrase. Every citation must resolve and have an exact supporting span; paraphrases are labeled as generated interpretation because structural citation checks cannot establish entailment. Structured candidates are always tentative and must cite an original OCR line. A narrow lexical guard rejects obvious safety/medical advice; it is defense in depth, not a general safety or truth validator.
- Allow paraphrases to cite a nonempty user-declared profile field by field name and exact span. This lets a future explanation state why context matters while keeping it distinct from package facts and external evidence; profile text cannot support a product-health or safety conclusion by itself. Tentative structured candidates remain limited to OCR-line and retrieved-source evidence.
- Offline tests use synthetic lines only. They verify traceability, a rejected approximate row, conflicting sodium readings, candidate non-promotion and calculation references. They do not measure photographic accuracy, model behavior or browser integration.

## 21 October 2026 — make parser candidate provenance explicit for future synthesis

- Keep the existing observation-to-assist path and add separate `numericEvidenceObservationIds` and `basisEvidenceObservationIds` to parser diagnostics. These point to the original recognized line(s) carrying a candidate value and its basis, including header lines, and are remapped when incremental scans deduplicate observations. They remain evidence links, not confirmations or table-cell associations.
- Require every future assist claim to choose `direct-quote` or `synthesis` explicitly. Prefer careful question-focused synthesis when explaining relationships among label observations, validated calculations, retrieved sources and user-declared context; retain exact-span citation checks and the current safety limits. A synthesis remains traceable, not entailment-verified.
- Offline tests cover an approximate/rejected value, two conflicting readings, distinct basis-header links, evidence-link remapping across incremental scan merges, and profile/source-aware paraphrase validation. No photo accuracy or Gemini behavior is measured; Gemini remains disabled.

## 21 October 2026 — connect package additive findings to official-source search

- Add a shortcut to additive-code findings that prepares the known additive name (when in the small local identity corpus), `INS` code and `additive` search term, and selects Indian regulation. Scroll and focus the search field so the next action is clear.
- Do not submit automatically. The user reviews the public query and explicitly chooses **Research sources**; no image, health profile or conversation is sent with this request.
- Chrome acceptance used synthetic label text with xanthan gum/INS 415 at 390×844 and 1440×900. It verified code detection, query/topic preparation, zero research requests before the button click and one request after it, followed by the official Appendix A excerpt and amendments-index link. This is UI and source integration evidence, not photo OCR, ingredient verification or authorization evidence.

## 21 October 2026 — add bounded on-demand FSSAI additive source retrieval

- Retrieve the official Appendix A PDF and link the separate additive-amendments discovery index only when query terms identify a food additive or INS code. Keep this additive-compendium entry's 6,000,000-byte, 380-page, 900,000-character and 900-character excerpt limits source-specific; generic PDF retrieval stays at 2 MB, 40 pages and 50,000 characters.
- Rank excerpts by inverse frequency of query terms and exact adjacent terms so rare ingredient names and numeric identifiers beat repeated headings. A regression captures the failure where common FSSAI/document words surfaced an unrelated section despite a matching additive row elsewhere in the document.
- Show the extracted text only as an uninterpreted navigation aid. The source page says the compendium is not a legal document and original Gazette notifications prevail; exact category conditions, later amendments, authorization and package compliance remain unresolved. Do not bundle the complete PDF; preserve attribution and third-party-content caveats from FSSAI's website policy.
- Chrome acceptance on isolated production build passed mobile and desktop with a relevant Xanthan/INS 415 excerpt, official source attribution, companion amendments-index link, scope caveats, 200 response and no browser provider/off-origin calls. Observed route latency with both sources was 8.349 s and 7.145 s. This is integration evidence, not a legal or scientific validation.

## 21 October 2026 — keep remembered user context separate and opt-in

- Keep user-declared context distinct from package observations, saved conversations, public evidence and exports. Default to an empty session profile; persist fields only after a separate user action in a dedicated versioned IndexedDB key.
- Reopening a saved scan may reuse the separately remembered user profile, but never reads profile fields from the scan record. Unchecking removes the local copy while retaining the current session values; clearing context removes both. Disclose that browser-profile access exposes the plaintext local record and that it is not encrypted or synced.
- Public product lookup may receive the selected country only. Other profile fields remain local in the current product flow; Gemini is disabled and still requires a separate consent flow before any future provider use.
- Chrome/Playwright verified empty default, opt-in reload, history reopen, record exclusion, uncheck/delete and session retention on mobile and desktop. This is synthetic UI/storage evidence, not real-photo accuracy or provider acceptance.

## 21 October 2026 — keep absent printed units annotatable and expose the real-photo bottleneck

- A readable nutrient value with a known basis may be annotated with `unit: null` when the package prints no separate unit. Require unit geometry only when a unit is actually transcribed; never infer a unit from convention.
- Keep the Grandma's Chocolate Brownie browser read as development-only after exposure. It returned 28 line observations but no independent reference, so record structural observations without scoring or changing the production OCR engine.
- The directly observed failure is column/basis reconstruction: two nutrient columns were not separated, leaving two conflicting fat candidates with unknown bases and no usable calculations. Detection/recognition attribution and parser omission counts remain unavailable without annotated polygons and transcript.
- Gate diabetes and sugar-claim references on explicit user intent. A generic nutrient-label question must not inherit diabetes education merely because OCR or package metadata contains a sugar-free claim.
- Leave the owner-managed port-3400 process untouched; build and browser-check current code in isolated `.next-acceptance` on a separate loopback port.

## 21 October 2026 — keep local conversation memory explicit

- Add a separate opt-in for saving up to 30 recent local question-and-answer turns with a saved package investigation. Saving turns also retains the package evidence and current amount needed to reopen the exchange.
- Keep profile fields, original images and Gemini answers out of the saved conversation. Questions may contain personal details, so the UI says that shared browser profiles can expose saved turns. Turning the option off removes stored turns; clearing history removes saved investigations.
- Validate both older package-only records and new conversation records through a bounded strict schema. On reopening, restore the saved turns and amount but start with an empty profile; a reopened saved scan reflects its saved state in the controls.
- Chrome/Playwright verified opt-in, reload and restoration of two synthetic turns, profile non-persistence and turn removal at 390×844 and 1440×900. No Gemini assist or vision route was called. This is local persistence/UI evidence only, not LLM or OCR evidence.

## 21 October 2026 — make independent OCR annotation executable

- Add a local-only browser route for independent source-pixel transcription and region geometry. Keep image bytes in tab memory, hash locally, and export only a strict single-reader pass with provenance metadata. Never include OCR output, image bytes, file names or local paths.
- Preserve the exact printed numeric string alongside normalized value and qualifier in the shared reference field. This is backward-compatible for existing dataset records.
- Require two separate reader passes, blind comparison, adjudication and an explicit agreement method before promoting a reference as human-verified. At that earlier annotation-tool checkpoint, all three new candidates were still unassigned and unscored; Grandma's Chocolate Brownie was later exposed to OCR and is now development-only.
- Keep production browser Tesseract unchanged, keep PaddleOCR.js diagnostic-only, and keep Gemini disabled. The five-photo comparison remains exploratory development evidence.

## 21 October 2026 — make OCR research scoring executable

- Keep browser-first OCR as the product baseline, but define the same transient extraction and sanitized evaluation contracts for browser, local/server, remote and hybrid candidates. Strict Zod contracts in `src/lib/contracts.ts` generate the dataset v2, extraction v1 and evaluation receipt v2 JSON Schemas.
- Score exact printed number/operator, canonical unit and serving basis separately. Count missing, explicit abstention, wrong fields, unscorable labels and extra candidates distinctly; preserve conflicts and printed zero. Do not score an unmeasured stage from final-parser output.
- Keep recognized text transient; tracked receipts retain normalized candidate values and sanitized stage flags, never raw OCR lines or image bytes. Use image hashes and dimensions to prevent mismatched comparisons.
- At that initial scoring-contract checkpoint, three sourced photos were unassigned and unexposed, pending independent double annotation and split lock. Grandma's Chocolate Brownie was later exposed in one qualitative product-flow diagnostic and must stay in development; the other two remain unexposed. Exclude the low-legibility Weet-Bix photo from clear numeric reference scoring and keep existing five-photo results in development only.
- Do not change production OCR or activate Gemini. The exact Open Food Facts photo reuse review remains pending; record uploader/source attribution and keep source image bytes private.

## 21 October 2026 — bootstrap

Read all seven required handoff documents and the original exported user decisions in chronological order. Latest owner intent supersedes old FastAPI/Qdrant/Firebase suggestions and fixed team role boundaries. Handoff is context, not implemented software. Existing folder had only .gitignore and ignored owner handoff. No source/team history or Git remote existed. Initialized local `main`; historical team attribution retained.

Adopted TypeScript-first Next modular monolith. Browser OCR and deterministic evidence experience progress without a Gemini credential. No key was found in this session's provider environment; did not search or reuse another app's secrets. Local journal chosen; no NutriScan-specific journal connector enrollment or publication was requested.

Owner's mission explicitly prioritizes implementation over waiting on three decorative concepts. Used installed Product Design audit skills for actual screenshot review. No image-ideation approval or Flowmate screenshot inspection was claimed. Product family direction comes from provided DNA, not copied source.

Parallel agents owned core engine, public/provider APIs and actual embedding retrieval; integrator owned contracts, browser/UI, testing and acceptance. Shared changes were coordinated. Captured actual semantic model/tuning metrics, public HTTP receipts and later browser evidence separately.

## 21 October 2026 — observed failures and repairs

- Next normalizes internal Request URL to localhost while browser Origin is127.0.0.1. Repaired validation using a strict loopback Host authority, ignoring forwarded host headers. Added regression tests.
- Source API's “nutrition” image metadata sometimes referred to front photographs and wrong language. Inspected images, recorded metadata mismatch and did not silently treat record labels as truth.
- Genuine glossy red can OCR initially missed the nutrition table. Added bounded local upscaling, contrast/inversion, back-region crop and single-block crop layout. Preserve poor output and conflicts; real-photo extraction is measured separately from synthetic parser tests.
- Browser contrast check identified pale captions. Darkened text and increased small copy before repeating accessibility checks.
- The original example-specific meal calculator and profile fields were removed. Optional context now uses separate empty fields, and no diet or health characteristic is inferred from an example.

See [acceptance](ACCEPTANCE.md), [core evaluation](CORE_EVALUATION.md), [retrieval evaluation](RETRIEVAL_EVALUATION.md) and [integrations](INTEGRATIONS.md) for actual states.

## 21 October 2026 — generalized reference amounts and product candidates

- A package's declared, dimension-compatible serving or explicit label basis may seed arithmetic; otherwise use a clearly labeled 100 g/ml comparison reference. Never reuse the demo fixture's amount as a production default or describe a reference as a recommended personal serving.
- Product alternatives are catalog candidates, not health rankings. Allow global search without inferred geography; when users enter a country, filter only against community country tags. Exclude the current barcode when supplied, normalize only explicit compatible bases, and keep stock, identity and formulation claims unresolved until verified against the package.
- Omit the optional profile field entirely from an assistant request when every user context value is blank. Blank objects do not represent user context.
- Keep food allergies and food intolerances in separate fields and separate prompt labels. The label can inform ingredient checks but cannot diagnose, prove individual safety or rule out cross-contact.
- Local ingredient comparison is literal and observation-linked. A miss remains unresolved; do not claim synonym, derivative, cross-contact or safety analysis that the parser has not performed.

## 21 October 2026 — incremental photo evidence

- Treat follow-up label photos as new evidence in the current investigation. Track OCR provenance by image ID and skip unchanged images; expose a deliberate full reread when there are no pending photos.
- Preserve the investigation, portion, chat and historical observations when new photo data is merged. Keep differing values on compatible bases and mark them as conflicts; never average or silently choose one. If a later barcode, brand or license observation conflicts, retain the observations and warning but clear the selected catalog identifier and leave the product search blank until the user resolves identity. Browser checks now cover photo add/edit/remove/replace and a real-photo incremental read; identity conflict and evidence-merging branches remain unit-tested rather than browser-verified.
- Clear product-dependent remote findings when package evidence changes. Keep local conversation available. The new photo read retained two prior questions and the portion; it did not validate extraction accuracy or product-formulation identity.
- Keep optional product-description text as a user-originated observation separate from OCR text. Surface it as unverified context in local audit and make the Gemini instruction retain that distinction. Pasted label text can augment an investigation while attached photos remain available for OCR; disclose that user-provided product details are stored when the user chooses local history or export.

## 21 October 2026 — expose scoped local references in package audits

- Local audit retrieval previously appeared only as a trace count; its curated source summaries were not available in the user-facing evidence ledger or consented synthesis context.
- Wire only query-intent-matched curated records into the audit as “Reference to inspect” context, preserving each publication's scope and limitations. Reuse already-cited sources instead of duplicating findings. Profile text is excluded from retrieval queries.
- Do not treat bibliographic metadata as dietary recommendations or static records as current legal evidence. Current regulatory-status questions do not surface the ICMR-NIN guideline record merely because India is mentioned.
- Verification: scoped-source tests, 94-test suite, TypeScript check and optimized build. This is local curated-evidence wiring, not live research verification or clinical answer validation.

## 21 October 2026 — optional photo barcode recognition

- Add local-only retail barcode detection using the browser-native API as a progressive enhancement. MDN documents limited availability and secure-context requirements; if unsupported or decoding fails, ordinary OCR continues and product details can still be entered manually.
- Accept only checksum-valid EAN/UPC values; preserve image IDs in barcode observations. Keep one unique code for product lookup, but withhold lookup if images disagree or decoded digits conflict with OCR text. A barcode is an identifier candidate, not proof of product variant or market.
- Barcode-only photos may start an investigation and route the displayed identifier to the user-triggered product lookup. No lookup or remote send occurs automatically. Unit-tested; browser/device acceptance remains pending.
- Cross-photo barcode, brand or license disagreement clears the active catalog identifier and default lookup. A user may still search public records manually, but package-to-record nutrition comparison remains withheld until a new investigation contains evidence for one package.

## 21 October 2026 — mobile guidance and OCR ingredient scope

- Below 700 px, stack the guidance steps in one column. Do not rely on an HTML line break for word spacing when responsive CSS may hide it.
- A code-looking OCR fragment outside a recognized ingredient section is not sufficient to assert an additive. Extract package additive codes only from parsed ingredient text; keep the original OCR visible so users can inspect noisy readings.
- Browser evidence: 390 px mobile and 1440 px desktop first visits, nine blank optional-context controls, open-ended text-only sodium question, and 25 g follow-up passed in Chrome. A genuine package label was also added to an existing investigation with both questions and the portion retained. No OCR accuracy or matching-formulation claim is made.
- The real-photo flow exposed an `E000` false positive outside the ingredient section. Ingredient-scoped extraction removed it in the repeated Chrome check and a regression test. Raw OCR remains available. Full suite, typecheck, production build and scoped axe checks are required before checkpointing.

## 21 October 2026 — annotated local-browser access check

- The user confirmed their in-app browser setting is enabled and attached a screenshot of the open NutriScan page with the navigation selected. The image was visible and inspectable in the conversation, while the CUA adapter still rejected tab attachment with a Work-settings error.
- Do not conflate that adapter error with the in-app pane being closed or the page being inaccessible. Use the already authorized local Chrome/Playwright route when fresh interactive evidence is needed; the local app route and actual rendered DOM remain independently testable.
- Fresh first-visit screenshots at 550 × 668, 390 × 844 and 1440 × 900 were captured and inspected. Axe reported zero violations and all three widths had no horizontal overflow; this does not establish full accessibility. Screenshots and exact receipts are in `docs/UX_AUDIT.md` and ignored `docs/evidence/private/`.

## 21 October 2026 — keep alternate OCR diagnostic-only

- Compared the production parser on five hash-verified public package-label photos using Tesseract.js original bytes, browser-prepared Tesseract.js bytes, and RapidOCR/PP-OCRv6 small with ONNX Runtime CPU. RapidOCR used OCR box geometry to form reading rows.
- RapidOCR matched 7/37 annotated fields with no incorrect matches, versus 2/37 for prepared Tesseract, but omitted or withheld 30/37 and averaged 7.5 seconds per photo. It returned no exact fields on the two Nutella language cases or Bagrry's; Bagrry's rows lacked an explicit basis and were withheld.
- On the same two manually selected panel regions, RapidOCR matched 10/17 annotated fields with zero incorrect, versus 0/17 for Tesseract.js; it supplied explicit basis for all ten parsed fields. This is a promising crop-specific result, but it only covers two hand-selected English photos and took about 9.8 seconds per image.
- Keep the browser-local Tesseract implementation and user-review boundary while testing browser-compatible ONNX feasibility. Do not ship a new ~31.8 MB Python/ONNX stack based on five selected photos and two hand-selected crops. The detailed method, reproduction and limitations are in `docs/OCR_ALTERNATIVES.md`; aggregate only is stored in `docs/evidence/rapidocr-evaluation.json`.

## 21 October 2026 — browser WASM OCR remains diagnostic

- Tested Transformers.js TrOCR small printed in q8 mode on separate manually selected nutrient-name/value crops from 13 rows on one Saffola image. One complete annotated label/value pair was recovered; automatic cell detection and wider evaluation remain absent. Warm inference took 32.8 seconds, and quantized encoder and decoder files alone are approximately 64 MB. Do not add it to the product on this evidence. Diagnostic: `npm run ocr:evaluate:trocr`.

- Tested PP-OCRv6 tiny in desktop Chrome with ONNX Runtime Web WASM against hash-verified Saffola and Bagrry's package crops. Both models loaded; the detector and recognizer completed local inference with no page errors. A simple row projection returned parser input.
- The production parser recovered 4/17 annotated fields with zero incorrect; Saffola produced 4/9 and Bagrry's 0/8, where ambiguous basis remained withheld. The manually cropped Saffola Energy row was separately recognized. Detector calls took ~0.3 s and all row recognition ~0.4–0.9 s per crop on this desktop.
- Total fetched assets for this diagnostic are approximately 20.9 MB (6.32 MB model weights, 368 KB JS runtime, 14.26 MB WASM and 24 KB module). Phone performance, cold-load UX and faithful DB contour post-processing remain untested. Keep the option diagnostic-only; do not add another path to the end-user scanner yet.
- The live OCR rows exposed a parser boundary case where a capitalized basis is glued to an all-caps heading. Added a parser-view normalization that retains the original observation verbatim, plus a regression test. Core tests and typecheck pass; current browser receipt: `docs/evidence/rapidocr-browser-runtime.json`.
- Refreshed the CPU comparison after that parser change: PP-OCRv6 small remains 7/37 exact full-frame and 10/17 on two guided crops, with zero incorrect; mean times are 7.4 and 9.6 seconds per image. Tiny remains smaller and quicker but scores 5/37 and 9/17. Keep the small model and WASM branch in diagnostics; results still do not justify a second reader in the product.
- Swept detector thresholds and row-band gaps in Chrome WASM and tested both Tiny and small models. Tiny remained at 4/17 baseline and small at 3/17; no tested configuration improved the respective score. Small model weights add about 25 MB over tiny and its five-configuration run exceeded two minutes on the desktop. Continue investigating the faithful detector/column reconstruction only if the real-device and broader-label budget warrants it; do not integrate based on these results.
- Added a threshold-connected-components/word-box extraction diagnostic on both browser models. It improved Tiny from 4/17 to 6/17 and small from 3/17 to 6/17, with every exact match on Saffola and zero on Bagrry's; no incorrect fields. This remains below local Python small's 10/17 on the same crops and still misses the two-column label. Keep it diagnostic-only; do not add a browser model bundle to the product.
- Expanded Tiny browser component evaluation to all five hash-verified full photos / 37 annotated fields. Projection matched 3/37 and connected components 6/37, both with zero incorrect; all six matches were on Saffola, with none on Coca-Cola, Nutella French/Spanish or Bagrry's. This is not broad coverage, but it confirms the crop-only Saffola result persists full-frame and does not generalize across this small sample. Receipt: `docs/evidence/rapidocr-browser-full-photo-evaluation.json`.
- Kept the native optional-context `<dialog>` and added explicit Tab/Shift+Tab boundary handling after Chrome showed focus briefly escaping to `body` at the final control. Repeated the keyboard flow at mobile and desktop sizes: all 12 tab steps stayed inside, Escape closed the modal, and focus returned to the opener. Full-page keyboard and assistive-technology acceptance still remain.

## 21 October 2026 — preserve Open Food Facts liquid nutrient bases

- The official Open Food Facts product schema documents normalized `_100g` nutrients as per 100 g or per 100 ml for liquids. A live Coca-Cola v2 record reported `nutrition_data_per: 100g`, `product_quantity_unit: ml`, beverage category tags, 10.6 g sugars and 42.4 kcal; the existing route mislabeled both values per 100 g.
- The source normalizer now interprets that normalized value as per 100 ml only when both the package unit is `ml` and category tags identify a recognized beverage branch. The UI displays the inference warning. Unclassified volume-packaged products retain their numeric observations but a null basis, which prevents comparison; no basis is inferred from volume quantity alone.
- Unit regressions cover the live beverage shape, unknown volume products, explicit 100 ml, explicit mass, missing values and true zero. A fresh public route call returned 10.6 g sugars and 42.4 kcal per 100 ml. A repeatable Chrome acceptance check exercises the same lookup and comparison-disclosure path at 390×844 and 1440×900. No package values are supplied, so the UI correctly leaves the comparison difference unavailable.
- Keep the record community-sourced: a barcode query does not prove exact package identity, regional formulation or current local stock. Sources and receipts: `docs/INTEGRATIONS.md`, `docs/evidence/openfoodfacts-liquid-basis-route.json`, and `docs/evidence/openfoodfacts-liquid-basis-browser.json`.

## 21 October 2026 — prevent OCR from inventing package identity

- Do not display low-confidence OCR or nutrition-table text as the package name. Fresh Chrome identified candidate titles at 22%, 64% and 71% line confidence; the latter two were serving metadata and nutrient rows. OCR-origin names now require a matching observation at least 80% confidence and must pass table-heading/row filters. Otherwise use “Unidentified package,” preserve original OCR lines, and disclose that name is unresolved. The 80% cutoff is a conservative display heuristic, not factual certainty; tests cover a 79% plausible name and an 82% candidate.
- Chrome testing exposed slogan fragments, a French adult-reference statement, noisy nutrient rows, and a low-confidence generic sauce description as false titles. Added multilingual reference/heading, slogan, nutrient-term and readable-word filters, plus the 80% OCR confidence cutoff and regressions. The latest mixed five-photo run (three front photos, two nutrition panels) had no false titles or page errors; three names were withheld and two photos received the low-text guard. The three completed result views contained no expected brand token; the two low-text cases are not scored for brand recognition. Product-name recognition remains unresolved. The repeatable result is `npm run ocr:evaluate:name-retention` and receipt `docs/evidence/ocr-name-retention.json`. A corrected harness verified that a low-text front photo promptly shows the existing guard, with all OCR assets HTTP 200 and no failed requests. With at least three characters of user-supplied details, the same front photo proceeds to an audit that labels those details unverified while keeping the title unidentified and photo attached. Reproduce with `npm run acceptance:front-photo-guard`.
- Extended the OCR alternative check to brand tokens on the same five mixed package photos. PP-OCRv6 small found Nutella at 0.95952 line confidence in one image and no expected brand token in the other four; Tiny found no brands across the set. Keep both diagnostic-only; their limited coverage and lack of browser/device acceptance do not justify integrating them into scans. Reproduce both with `npm run ocr:evaluate:rapidocr:names`.
- A browser-WASM probe added evidence for a separate runtime path: PP-OCRv6 tiny and small both found Heinz on one of five full photos, with ~99% confidence, but CPU tiny missed every brand. Tiny adds ~14.7 MB browser runtime beyond its 6.32 MB weights; browser small detector time reached ~12.5 s. The browser implementation uses heatmap approximations and has no phone evidence. Keep it diagnostic-only; do not ship based on one cross-runtime, one-brand result.

## 21 October 2026 — OCR rerun after parser changes

- Repeated the five-photo Tesseract diagnostic and the same-photo RapidOCR comparison against the current parser. Prepared Tesseract matched 2/37 annotated fields with zero incorrect; RapidOCR small matched 7/37 full-frame and 10/17 on two manually selected crops, also with zero incorrect. The generated receipts are `docs/evidence/real-ocr-evaluation.json` and `docs/evidence/rapidocr-evaluation.json`.
- The parser fixes did not improve broad image-text coverage. Keep Tesseract as the current local reader with user review and explicit withholding; keep RapidOCR as a crop-specific diagnostic pending a larger held-out set, faithful column reconstruction and real-phone latency/memory evidence. A remote vision alternative remains disabled under the project contract and would require owner approval for image transfer and cost.

## 21 October 2026 — verify fallback amount and identity conflict in Chrome

- Added reproducible browser checks for two safety-critical UI behaviors that previously had unit coverage but incomplete browser evidence. A synthetic text-only label with ingredients and no nutrition basis starts at the explicitly non-personal 100 g comparison reference and invents no nutrient values. Conflicting pasted brand/barcode evidence clears automatic product search; an explicitly searched catalog record remains uncomparable to the disputed package.
- Both checks pass in Chrome at 390×844 and 1440×900 with zero axe violations and page errors. They do not establish OCR-based conflict detection, a personalized serving recommendation, or real-package identity. Receipts: `docs/evidence/neutral-reference-browser.json` and `docs/evidence/identity-conflict-browser.json`.
- Revalidated the optimized production build from an isolated source copy with Next.js 16 webpack so the running dev server's `.next` directory remained untouched. Routes compiled and prerendered successfully; the live loopback server continued returning HTTP 200.
## 21 October 2026 — show local evidence provenance and scope

- Local evidence search cards now display publisher, jurisdiction, retrieval date, and the source-specific limitation beside the linked summary. They remain labeled candidates and omit an unvalidated similarity score from user-facing results.
- Added the official WHO 2023 carbohydrate-quality guideline to the curated corpus for fibre, whole-grain, fruit, vegetable and pulse questions. Its adult amounts are identified as whole-diet population guidance; the record states that naturally occurring fibre guidance cannot be equated with a packaged-food fibre declaration or individualized target.
- Rebuilt the local MiniLM index for corpus version `2026-10-21.3`; runtime uses the bundled local model and never initiates remote model downloads. Current source count is reported from the corpus rather than a stale hard-coded number.
- Chrome/Playwright checked exact additive-identity and WHO dietary-fibre queries at 390×844 and 1440×900. The Codex and WHO source links, publisher/jurisdiction, summary and scope limits were visible; both runs had zero Axe violations and browser errors and sent no request off loopback. This is a two-query smoke test, not broad relevance or source-quality validation.
## 21 October 2026 — verify comparison and alternative-candidate journey

- Added a repeatable Chrome/Playwright flow for an explicitly synthetic Nutella label fixture, a live Open Food Facts barcode lookup, per-25 g to per-100 g normalization, and candidate search that excludes the current barcode.
- The run rendered nine comparable nutrient rows and withheld salt because the fixture did not provide a package reading. Four catalog candidates were returned at both 390×844 and 1440×900. Cards preserved community-data and local-stock limits; comparison named the recorded-barcode/variant caveat and made no health ranking.
- Axe found zero violations and there were no page errors or browser requests off loopback. This is a live catalog/browser integration check, not an actual package photo, regional formulation check, stock claim or recommendation. Receipt: `docs/evidence/product-alternatives-browser.json`.
## 21 October 2026 — bound live research-card previews

- A real mobile Chrome capture showed that six live Europe PMC abstracts made the research section excessively long. Research cards now show a 360-character preview and retain the full abstract/source excerpt in a native expandable disclosure; publication metadata, source link and limitations remain visible without opening it.
- The repeatable science-research browser check verified six live candidates, expandable full text, official Europe PMC links, population/study caveats, and no raw HTML rendering. Mobile and desktop runs had zero Axe violations, page errors, off-loopback browser requests or horizontal overflow. This improves scanning but does not validate result relevance or study quality.

## 21 October 2026 — suppress weak and out-of-scope local evidence results

- A separate probe showed that the nearest-neighbour endpoint returned a dietary bibliography for a current ORS-law question (hybrid score 0.40), even though the small static science corpus cannot answer current law. Five unrelated developer-authored queries scored 0.10–0.16; four supported or scope-boundary queries scored 0.34–0.65.
- Added a 0.30 development score floor and a direct current-law intent gate covering common terms such as ORS, FSSAI and Gazette. The guard is not calibrated and cannot classify every paraphrase; each result remains a candidate requiring applicability review.
- Eleven model probes now return expected match/abstention behavior. Production Chrome confirmed supported Codex/WHO cards and empty results with clear messages for weather, ORS and FSSAI legal queries at mobile and desktop sizes. No browser errors, Axe violations or off-loopback requests. Receipts: `docs/evidence/semantic-boundary-diagnostic.json` and `docs/evidence/local-evidence-browser.json`.

## 21 October 2026 — ground diabetes carbohydrate follow-ups without a personal target

- A real-photo production journey revealed the need to answer the asked carbohydrate question directly when the user supplies diabetes context, while distinguishing the package amount from an individual daily target.
- The local audit now reports the readable package amount only when available; otherwise it says the scan cannot establish carbohydrate for the selected portion. In both cases it says no personal daily allowance is set, points to NIDDK's general education and suggests comparing against guidance from the user's health care team.
- Chrome verified the flow with a synthetic Type 2 diabetes profile and the hash-verified Saffola photo at 390×844 and 1440×900. One nutrition value was user-corrected with original OCR retained; the 50 g calculation remained 1.7 g, the profile question and NIDDK source link were present, and no daily target or off-loopback request appeared. This is not clinical suitability evidence.

## 21 October 2026 — retain conservative browser OCR pending stronger evidence

- Repeated the actual Chrome/Playwright browser OCR comparison on five hash-verified package photos. Across 14 full-frame, crop and contrast cases / 118 annotated field comparisons, Tesseract matched two fields, misread two, omitted 111 and withheld three. The repeated user-selected Saffola crop recovered one exact-basis field; contrast on that crop introduced two incorrect values.
- Repeated the local PP-OCRv6 alternative comparison: RapidOCR small matched 7/37 annotated fields full-frame and 10/17 on two manually selected crops, with no incorrect annotated match, but took about 7.4–9.5 seconds per image on this CPU. Browser WASM remains a diagnostic prototype and has not established phone performance or reliable multicolumn handling.
- Keep Tesseract.js as the browser reader, retain explicit crop and correction controls, and preserve basis/conflict withholding. Do not make contrast automatic or add RapidOCR to the product on this sample; the evidence is too narrow and its runtime/model/licensing and phone costs are unresolved. The weak field coverage remains an acceptance blocker, not a reason to infer unreadable values.

## 21 October 2026 — include NIDDK's carb-counting qualification

- The current NIDDK page describes carb counting and the plate method as planning options and states that not everyone with diabetes needs to count carbs. The local source summary and both known- and missing-label follow-up answers now preserve that qualification rather than implying a universal counting plan.
- The source was checked on 21 October 2026; its record keeps US general-education scope and does not provide an individualized target. The local evidence index is corpus version `2026-10-21.4`. Added a versioned query, source-content regression checks, and Chrome assertions for the real-photo diabetes follow-up.
- Focused retrieval remains top-1 15/15 semantic and hybrid across the developer-authored set; full unit tests, typecheck, and mobile/desktop Chrome acceptance passed. These checks do not independently validate medical advice or general retrieval quality.

## 21 October 2026 — verify keyboard intake and result navigation

- Added `npm run acceptance:keyboard-application` to traverse first-visit controls and the text-only result state with Chrome keyboard input at 390×844 and 1440×900. The test opens the label dialog with Enter, enters text, submits from the keyboard and verifies focus containment and return to its trigger.
- Full tabbable traversal covered 11/11 first-visit and 22/22 result controls on mobile, and 13/13 and 24/24 on desktop. All stops had accessible names; no axe violations, page errors or off-loopback requests occurred. This is scoped intake-to-result coverage, not proof of every research state, screen-reader or WCAG conformance.

## 21 October 2026 — externalize PDF.js for live regulation extraction

- Live route probes showed that `pdfjs-dist` worked in a direct Node diagnostic but every PDF parse failed inside the Next.js route. Next.js 16's bundled package-bundling guide documents `serverExternalPackages` for dependencies that need native Node loading; externalizing `pdfjs-dist` restored extraction from the official, selectable-text FSSAI 2024 ORS order.
- The 2022 direction and the 2024 order are extractable, and the 2024 order is explicitly labeled superseded by the 14 October 2025 withdrawal. Raising the per-source bound from 1.2 MB to 2 MB admitted the 1.65 MB 2022 PDF. The scanned 2025 PDFs still have no selectable text and court-PDF extraction varies across route attempts. Preserve direct links and explicit unknown status; do not infer a current rule from historical sources.
- A mobile/desktop Chrome run also found long legal identifiers forcing 10 px horizontal overflow on mobile. `overflow-wrap:anywhere` on research cards removed page overflow; Axe and page-error checks remained clear. Receipt: `docs/evidence/regulatory-research-browser.json`.

## 21 October 2026 — use bounded local OCR for scanned official PDFs

- Integrated Tesseract.js OCR only for two fixed FSSAI 2025 scanned PDFs after the local PDF.js plus canvas rendering path succeeded. OCR is capped at two pages per source, 4 million pixels per page and a 30-second shared OCR deadline; only the short excerpt is rendered, explicitly marked unverified and not interpreted. No user images or personal profile data enter this route.
- Externalized `tesseract.js` alongside `pdfjs-dist` using Next.js 16 `serverExternalPackages`. This removed a Next dev worker-script resolution error and reduced the live route from about 29 seconds to 18 seconds in the isolated local dev instance. The OCR output is still a machine observation; no manually verified transcript or current-law conclusion is claimed.
- Chrome/Playwright acceptance passed at 390×844 and 1440×900. It expands the two OCR source excerpts before checking disclosure. Five source cards were visible, current law and package compliance remained unverified, and Axe, page errors, off-loopback browser requests and horizontal overflow were all zero. Receipt: `docs/evidence/regulatory-research-browser.json`.

## 21 October 2026 — preserve provenance for salt equivalents and Gemini excerpts

- When a salt-amount question has compatible sodium evidence but no package salt row, expose an explicitly approximate salt equivalent using WHO's published relation of 1 g salt to 400 mg sodium. Keep sodium as the package observation; link the calculation to that observation and WHO source, say the result is not a printed salt declaration, and do not convert across incompatible mass/volume bases. A declared salt row takes precedence.
- Initial Gemini boundary: citation IDs alone are not support; each cited observation/source summary needed an exact span, and answers were assembled from bounded evidence. That quote-only fallback was later superseded by the cautious `synthesis` mode recorded in the OCR-provenance decision above: paraphrases may be returned with exact supporting spans and an explicit non-entailment disclosure. Offline schema and validation behavior are tested, but live provider compatibility remains unverified; keep Gemini disabled pending authorization.
- Added engine regressions and text-only Chrome acceptance at 390×844 and 1440×900. The browser scenario reports 0.375 g equivalent from 500 mg/100 g at 30 g, with zero Axe violations, page errors or off-loopback requests. This is not OCR, package identity or medical-suitability evidence.

## 21 October 2026 — retain OCR reader after segmentation-mode probe

- Used Chrome/Playwright on the live local UI to rerun 14 actual upload, crop and contrast cases on hash-verified public package photos: 2 correct, 2 incorrect, 111 omitted and 3 withheld out of 118 annotated fields. The selected Saffola crop repeated one exact-basis match; contrast on that crop again produced two wrong values.
- Added a reproducible Tesseract.js page-segmentation diagnostic for four modes across two human-selected real-label crops. It produced no safe gain: AUTO, SINGLE_COLUMN and SPARSE_TEXT recovered no annotated fields; SINGLE_BLOCK emitted one incorrect Saffola field and withheld one. Bagrry's remained at zero matches in every mode.
- Keep Tesseract.js as the local browser reader and preserve crop, review and correction. Do not add automatic multipass or contrast based on these results. This sample is too small for population claims, and broad OCR coverage remains blocked on paired independently annotated labels and phone/device measurements. Receipt: `docs/evidence/ocr-segmentation-modes.json`; command: `npm run ocr:evaluate:segmentation`.

## 21 October 2026 — benchmark official PaddleOCR.js without changing the reader

- Added the official PaddleOCR.js PP-OCRv5 browser SDK as an exact-pinned development-only dependency and ran it on the same five hash-verified full-frame photos and production parser as the current Tesseract/RapidOCR comparison. The exploratory set has 37 annotated fields and no held-out products. Exact/incorrect/omitted/withheld counts were 6/0/21/10 for PP-OCRv5, 2/0/34/1 for browser-prepared Tesseract, and 7/0/24/6 for local RapidOCR small.
- Added sanitized per-field label/value co-occurrence, basis-text, parser-emission, and exact unit/basis flags to the Paddle receipt. These explain some loss patterns but are not independent detection recall: there are no annotated text-region polygons or table columns, and same-row presence is only a geometry proxy. The receipt records no OCR strings or image bytes. In the latest single run it measured 5.30 s cold initialization, 25.46 s total inference, 38.25 MB model requests (21.55 MB unique model archives), 28.40 MB WASM transfer, and a 10.90 MB benchmark bundle; sampled JS heap ranged from 9.3 to 14.6 MB and excludes WASM/native allocations.
- Publish common dataset and result schemas plus a public protocol in `data/ocr-dataset.schema.json`, `data/ocr-evaluation-receipt.schema.json`, and `docs/OCR_RESEARCH_PROTOCOL.md`. The current five-photo set remains development-only. A product-grouped held-out dataset and region/row/column annotation are still needed to measure stage-level precision/recall. Keep production Tesseract unchanged, keep Paddle diagnostic-only, and keep Gemini disabled pending explicit authorization.

## 21 October 2026 — answer package-text questions from recorded observations

- Local follow-ups may quote ingredient text, allergen statements, and recognizable package claims only from matching observation rows. Link the answer to those observation IDs and disclose that OCR or transcription may be wrong; a missing row must remain unknown rather than imply absence.
- Keep this as bounded deterministic local behavior. It improves evidence-grounded conversation without claiming general language-model reasoning or changing the OCR reader. Gemini remains disabled.
- Chrome/Playwright exercised the actual intake, pasted-label, result, and follow-up UI at mobile and desktop viewports using explicitly synthetic text. Both positive answers and the missing-text case passed; this is UI integration evidence, not photo OCR evidence.

## 21 October 2026 — summarize uncertainty in the consumer flow

- Keep the main results view readable by grouping unresolved label-reading issues into plain-language copy. Preserve every parser warning under a collapsed label-reading disclosure, with general limitations separate. The short summary must not imply that OCR readings were verified.
- The fresh Saffola browser journey retained its exact saturated-fat evidence and corrected calculation while showing a shorter uncertainty summary. The 390x844 and 1440x900 run had zero Axe violations, page errors, off-loopback requests or provider calls. No OCR reader or accuracy result changed.

## 21 October 2026 — connect WHO free-sugar guidance to local product questions

- Add the official WHO guideline on sugars intake as an original concise source summary with publication date, retrieval date, global population scope and rights note. Do not reproduce the publication or map a package total-sugars value to a personal daily free-sugar amount.
- Route explicit free/added-sugar guidance questions to the WHO source in the local audit and MiniLM retrieval while keeping simple nutrient-amount questions on the quick calculation path.
- Rebuilt corpus version 2026-10-21.5 and measured the 18-case developer query set: hybrid Top-1 18/18, Recall@3 18/18; lexical and semantic Top-1 each 17/18. All 12 local boundary probes met their expected behavior. Mobile/desktop Chrome verified the source card and abstention messages; this is not held-out relevance evidence.

## 21 October 2026 — bind assist image handles to OCR capture provenance

- The consented text-assist request already carries every package observation, OCR order/geometry/confidence, capture engine and processing metadata, and parser-rejected/conflicting candidates. Add a consistency check between a matching live image handle and its capture ID, side and original dimensions; do not require photos for restored/text-only sessions.
- Keep image bytes out of this request. A model-requested image inspection still requires the separate explicit user action. Do not add a persistent image digest while original photos are not retained; the session image ID and capture metadata are the available provenance.
- Review confirmed that synthesis mode already supports concise profile-specific paraphrases, with exact evidence spans and an explicit non-entailment disclosure. Citation matching establishes traceability, not that a claim follows from its evidence. No synthesis or safety behavior changed; Gemini remains disabled.
- The focused assist contract test passed (10 tests), the full suite passed 284 tests across 31 files, and TypeScript typecheck passed. No provider call or live model claim was made.

## 21 October 2026 — keep noisy OCR and additive identity evidence inspectable

- Re-audit found the existing bounded assist contract already carries every OCR line, order, line/word geometry and uncalibrated confidence, capture engine/settings and session image provenance, plus parser-rejected/conflicting numeric and basis candidates. Retrieved sources can accompany the request. Tentative candidates require exact spans to original OCR lines, remain explicitly tentative and never enter package facts; image bytes require a separate explicit inspection action. The contract has line geometry rather than annotated table cells and does not retain a durable image digest.
- Keep the existing synthesis mode for conversational, profile-aware explanations. Every factual claim still needs validated IDs and exact cited spans; validation establishes traceability, not entailment. Keep Gemini disabled. No schema rewrite or provider call was warranted.
- Expanded the small identity corpus with official FAO/WHO Tartrazine (102), Potassium Sorbate (202), Sodium Benzoate (211) and Calcium Disodium EDTA (385) records. Treat them as identity/synonym references only, not proof of ingredient presence, dose, national permission or individual safety.
- Offline assist tests and the 18-case developer retrieval evaluation remain distinct from provider or held-out evidence. Chrome/Playwright checked the local source journey at phone and desktop sizes; all 12 evidence-route calls returned HTTP 200, with no Axe violations, page errors or off-loopback requests.
- A focused offline regression exercises the noisy OCR + retrieved JECFA synonym + tentative candidate path; it passed with the full 298-test suite across 33 files and TypeScript typecheck. This is contract evidence only.

## 21 October 2026 — record field coverage in the real-photo journey

- Keep the current browser-first reader unchanged pending independently annotated comparisons. In the same hash-verified development photo, both viewports exposed 16 OCR lines and 95 word boxes but only one structured nutrient row. Of nine single-reader reference fields, the row matched one value, unit and per-100 g basis; five fields were omitted and three withheld, with no incorrect emitted field.
- This end-to-end receipt does not distinguish recognition failure from geometry association or parser rejection for every absent field. Existing stage-level experiments point to association and parser acceptance as plausible bottlenecks, but their geometry-based measures are heuristic. Do not use this one-image result to choose a replacement engine or claim population accuracy.
- Retain raw OCR, geometry, confidence and parser diagnostics in the consented text-assist contract; keep any future model interpretations tentative and traceable. Image bytes remain behind the separate explicit inspection action. Gemini remains disabled.
- Chrome/Playwright captured the real-photo flow at 390×844 and 1440×900. The OCR-region inspection remained local, and the journey supported correction, calculation, evidence-linked follow-up and adding another package photo. Axe reported no violations; no page errors or off-loopback requests occurred. These are usability/integration checks, not proof of OCR correctness or full accessibility conformance.
- Preserve stage-specific failure evidence without claiming a detector metric: energy's parser candidate missed the annotated number and unit while its basis candidate matched; fat retained two numeric candidates including the annotated value but lacked a unit; sodium's unit and basis candidates matched but its numeric candidate was rejected as invalid. Five other annotated fields produced no field-level parser diagnostics. The 22% heading confidence is engine-specific and uncalibrated. These observations support both recognition and row/unit/parser problems on this photo, while leaving the five omissions unattributed.

## 21 October 2026 — let users add package evidence from unresolved results

- When the package name is unidentified or no ingredients were read, show a direct action to add a front, ingredients, or barcode photo. It reuses the existing local multi-photo input, returns attention to capture, and stays hidden at the ten-photo limit; it does not infer a missing fact or invoke a remote service.
- Installed Chrome verified the action and native picker opening at 390×844 and 1440×900 on the hash-verified Saffola nutrition photo. The picker was canceled without adding another image, so this confirms UI routing, not the value of a complementary photo. OCR remained 22 lines / one parsed nutrient row; no accuracy result changed.
- Axe violations, page errors, off-loopback browser requests and provider calls were zero. Full offline tests remain 284/31 files; typecheck passes.

## 21 October 2026 — explicit, bounded conversation context for future assist

- Local Q/A history may help a future assistant resolve follow-up references, but it is not scientific or package evidence. Keep it out of Gemini requests unless the user checks a separate option; send at most four newest turns and cap question/answer lengths in both the browser payload builder and server schema.
- Conversation turns cannot be cited through the evidence schema. The provider instruction says prior assistant answers are unverified and may resolve intent only. Exact-span citation checks and safety constraints still govern factual claims. Gemini stays disabled pending owner authorization.
- Chrome acceptance confirms the default-off control and explicit toggle at phone and desktop viewports, with no provider/network side effect. Offline tests cover payload bounds and evidence rejection; these checks do not demonstrate model-backed follow-up quality.

## 21 October 2026 — answer all requested label nutrients locally

- A multi-field nutrient question should surface each requested value already supported by the same package record, rather than selecting only the first matching field. Use explicit aliases such as calories/kcal for energy and preserve the existing evidence-linked calculations.
- For a requested field with no usable value, state that it is unknown; do not fill it with zero. Keep specialized diabetes guidance, sugar-claim handling and sodium-to-salt wording on their existing paths.
- Regression tests cover multi-field values, calories-only, unknown sugars and observation links. Synthetic Chrome acceptance at mobile and desktop sizes confirmed 114 kcal, 18 g carbohydrate and 1.2 g total sugars for the declared 30 g serving. This measures text-input product behavior, not photographed-label accuracy.

## 21 October 2026 — retain selected-image lineage on explicit vision observations

- Keep the existing OCR text-assist contract and browser-first reader. It already carries raw lines, order, token geometry and recognition metadata, capture settings, parser rejection/conflict candidates, and evidence-linked tentative candidates; OCR observations remain distinct from structured package fields.
- Extend only the separate, consented image-inspection result boundary: each returned vision observation links to the selected session image and run, and the package records image side, caller-supplied source dimensions, normalized crop and preprocessing, and model identifier. Later text-assist requests preserve this record and validate any matching live image handle.
- Retain no image bytes or durable digest. The source dimensions are client-provided and are not verified against original bytes because inspection sends a prepared image/crop. Image transfer remains a separate explicit user action. Vision output stays unverified; disagreements remain observations and comparable numeric conflicts remain withheld.
- The existing answer contract supports direct quotation or evidence-linked synthesis, including profile context. Exact-span validation, claim filtering and the traceability-versus-entailment limitation remain in force; the intended response is not restricted to verbatim quotation. Gemini remains disabled.
- Offline checks passed, including 321 tests, TypeScript, and an isolated optimized build. The synthetic typed-text browser receipt has zero provider calls. No OCR/photo accuracy measurement changed.

## 21 October 2026 — make unknown source reuse terms explicit

- Each curated knowledge record carries a license/terms note. Keep verified restrictions where available and mark other terms unverified; do not infer an open license from an official or academic publisher label.
- The corpus summaries, citations, retrieval text and embedding fingerprint are unchanged. Do not rebuild embeddings for a metadata-only license-note change; the existing versioned index hash was rechecked and still matches.
- This is provenance visibility, not legal clearance. No full source text or dataset was added.

## 22 October 2026 — isolate contributor code at existing seams

- Move working implementations incrementally under `src/modules/ocr/`, `src/modules/knowledge/` and `src/modules/inference/`; keep old `src/lib/` entry points as compatibility adapters so current application callers and browser behavior remain stable.
- Keep `src/lib/contracts.ts` as the only shared production-schema source. Module code may depend on that contract but must not import another module's internals. A simple checked import boundary and per-module file-scope checker are sufficient; do not add workspace/package infrastructure.
- Keep browser persistence, barcode composition, product orchestration, routes, Gemini configuration/vision, consent and shared contracts owner-controlled. Inject the additive identity resolver into OCR; split Knowledge's static browser-safe entry from Node/MiniLM retrieval; keep Inference provider-independent and map its typed validation errors in the existing Gemini adapter.
- Verification evidence is the 362-test full suite, three module-local fixture suites, TypeScript, optimized build, import-boundary check and real-photo Chrome journey recorded in `STATUS.md`. The photographed-label measurement remains 1/9 exact, with five omitted and three withheld; module isolation is not an OCR accuracy improvement.
## 22 October 2026 — expand local additive identity retrieval and hold private push for image rights review

- Add only two source-backed Codex GSFA identity entries, INS 322 and INS 551. Preserve the 322(i)/322(ii) distinction as unresolved for generic lecithin and state that identity records do not prove product presence, dose, national permission or individual safety. The GSFA record reuse terms remain unreviewed.
- Regenerate the compact MiniLM index from cached local assets. On the 21 implementation-authored queries, lexical scored 20/21 Top-1 and Recall@3, MiniLM 18/21 Top-1 and 20/21 Recall@3, and hybrid 21/21. Keep these results labeled development-only; no independent relevance or OCR accuracy claim follows.
- Installed Chrome confirms the actual local source flow at mobile and desktop sizes, including links, source scope and abstentions. The run uses eight evidence requests per viewport and waits for the server's 12-per-minute local budget to reset between viewports. All 16 requests returned HTTP 200; Axe violations, page errors and non-loopback requests were zero.
- The existing private GitHub repository is verified empty/private. The 149-commit history present before this checkpoint remains unpublished: two tracked historical screenshots contain package photographs with unresolved reuse rights. The scanner found no literal credential; its only candidate is the expected server-side environment-variable reference. Resolve by documenting image-specific permission or by obtaining explicit owner approval for a narrowly scoped screenshot replacement in history; keep the original local evidence. No rewrite, deletion or push was performed.
- Full suite: 363 tests across 41 files; TypeScript and the six-test Knowledge module suite pass. Gemini remains disabled.

## 22 October 2026 — keep the OCR-to-assist evidence seam unchanged

- The existing shared observation and parser-diagnostic schemas already carry ordered OCR lines, word boxes/confidence, image/capture provenance, and rejected or conflicting numeric/basis candidates into the consented assist payload. Duplicate `rawText` is removed only on exact line-by-line equivalence.
- Keep evidence-linked synthesis enabled with exact cited spans and a visible limitation that citation matching does not prove entailment. Keep direct quotes and tentative candidates; do not promote inferred label content into package facts. Image inspection remains a separate consented request. No contract change or Gemini call was justified by this audit.

## 22 October 2026 — summarize uncertainty without discarding OCR evidence

- Keep the deterministic follow-up question-focused: name unresolved fields and missing package panels, then direct the user to the detailed label notes and original observations. Preserve conflict/rejection evidence in the package ledger and finding links; do not repeat parser-internal wording in the conversational answer.
- A same-image Chrome run reduced this answer from 953 to 319 characters at mobile and desktop sizes. This measures response length only; OCR accuracy remained 1/9 exact on the single-human-read development image. Gemini stays disabled.

## 22 October 2026 — keep application adapters on module public entries

- Owner-controlled OCR facades import through `src/modules/ocr/index.ts` and selectively re-export the compatibility surface. Contributors can change module internals behind that entry without changing application adapters. Keep shared Zod contracts centralized; Knowledge's MiniLM path stays explicitly behind `server.ts`.

## 22 October 2026 — check numeric synthesis against its cited evidence

- Exact citation spans establish traceability but not entailment. As an additional deterministic guard, Arabic-numeral quantities in a synthesized claim must match a cited span after basic unit normalization; calculated quantities must be present in a cited calculation span. Withhold mismatches rather than silently treating citation presence as numerical support. This does not yet check written-out numerals or semantic entailment.

## 22 October 2026 — keep restricted evidence out of the private published history

- Preserve the original history and image files in a verified local backup. Perform path-only filtering in an isolated clone, ignore the two owner-identified screenshot paths, and publish only sanitized `main` to the existing private repository after clean-clone tests and build pass. Do not rewrite the active checkout or publish other refs.

## 22 October 2026 — map only clearly aligned OCR values to a recognized basis

- Keep Tesseract and production OCR configuration unchanged: targeted row and word-crop retries did not improve the same development photographs. The parser may skip at most two short, very low-confidence leading OCR tokens before a recognized nutrient label, then select one numeric reading only when its unit is explicit, its word box is uniquely aligned to one recognized basis, and both lines share the same image and OCR capture. Preserve all other readings as unassigned candidates; missing units, ambiguous bases, weak geometry and cross-capture layouts remain unresolved. This is a narrow parser recovery, not a held-out accuracy claim or a reason to enable Gemini.

## 22 October 2026 — make Indian packaged food the primary OCR target

- Prioritize Indian-market English labels, serving quantities, ingredients and allergens; evaluate English/Hindi and Devanagari next when rights-cleared examples are available. Keep the French and Spanish photos as secondary regression cases.
- The Table Transformer probe is not integrated: it gave useful row geometry on one Indian oats label but over-split columns on the other, with no gold geometry or text-to-cell annotations and 886 MB peak CPU RSS. Reconsider only with broader Indian development images and measured structured-field gains at feasible runtime and memory.
- Retain a global printed “Approximate Values” qualifier through uncertainty summaries and portion calculations. Readings remain usable as estimates; this correction does not increase OCR recovery.

## 22 October 2026 — bound split-header reconstruction to explicit Indian label evidence

- Preserve Tesseract and PaddleOCRv6 as the current recognizers. Pair split nutrition headers only when their adjacent lines belong to the same OCR run and image, explicitly show two `Per` columns, a printed serving basis, and a GDA/RDA marker. Use printed text order only when there are exactly two clean numeric values and two bases with clear separators; retain fused or ambiguous values as conflicts. Keep both original header lines and their provenance.
- Compare repeated nutrient readings using their printed decimal precision as well as the existing tolerance. This avoids flagging values consistent with independent label rounding, while larger disagreements remain conflicts.
- Do not integrate Table Transformer from this probe: full-frame CPU use was 843.6 MB peak RSS and 4.13 s, its table box extended into adjacent copy, and its row/column detections have no independent geometry labels or OCR-cell associations. The human-cropped result is exploratory only.

## 22 October 2026 — make missing coverage and non-nutrient recovery first-class

- Every real-package evaluation reports per-product-group and per-basis denominators with correct accepted, incorrect accepted, omitted, withheld, total unusable and usable coverage counts. Two photos, repeated scans, serving columns or crops from one product do not increase the independent product count.
- For every unusable field, record whether usable label/unit/value/basis evidence exists in raw OCR, parser candidates or alternate reads, and name the blocking stage. A tentative or conflicted candidate is not recovered. Score product identity, serving declarations, ingredients and allergens separately; mark ingredient accuracy unscored when no adjudicated transcript exists.
- The current Maggi receipt demonstrates the format, not representative accuracy. Ingredient geometry recovery exposes raw text for review but does not establish that the transcribed ingredient list is correct. No acceptance threshold is relaxed to improve coverage.

## 22 October 2026 — recover a uniquely aligned fused nutrition token

- A numeric token may be split into printed values only when the same photo and OCR run expose both declared serving headers, both header-derived value centers fall inside the fused token box, and exactly one numeric split aligns to those centers and its split boundary. Keep the original OCR token untouched and link the tentative reconstructed row to it. If geometry, headers or split uniqueness is absent, retain the prior conflict/withholding behavior.
- This recovered both Maggi sodium bases on the same two photo bytes without an accepted error: 14/16 to 16/16 exact fields, 0 wrong, 0 omitted, and 2 to 0 withheld. This remains a one-product exploratory result against a same-source single-reviewer read.
- Do not accept a package name from OCR candidates found only in images with multiple recognized nutrition rows. A separate image without the nutrition-panel signal can still supply the identity; absent that evidence, retain the raw line but leave identity unresolved. This prevented one demonstrated false product name on the Maggi back-panel photos and does not claim successful product identification.

## 22 October 2026 — accept narrowly evidenced serving-measure normalization

- Normalize the OCR label variant `Serveasure` only in the bounded serving-measure parser, retaining the original OCR observation and parsed evidence link. Keep `servings per pack` counts distinct from serving mass. This recovered 38 g on one Indian development photo and populated the real flow's default portion; nutrition-field coverage did not change.
- Do not retain an OCR-geometry automatic crop retry from this run: it remained at 5/9 nutrition fields and changed a visible `g` to `9`. Keep crop-free production behavior until another generalizable method demonstrates a coverage gain without incorrect accepted fields.

## 22 October 2026 — pin the current Gemini candidate and keep model interpretations separate

- Use exact stable `gemini-3.8-flash` as the initial free-tier general candidate; do not use `gemini-flash-latest`, 3.7, or 2.5 for new integration work. Google still lists 2.5 Flash for some existing projects (so it is not accurately described as shut down), but restricts new-project access. Gemini 3.7 is replaced by 3.8. Gemini 4 Argon is now the newest flagship and supports images plus structured output, but is paid-only and substantially higher priced; benchmark it only after explicit paid authorization and adapter updates.
- Set low thinking for the 3.8 path, bound output, remove temperature/candidate-count parameters, and retain SDK usage accounting for prompt, candidate, thinking, total tokens, model version and latency. Current free project availability does not establish response quality.
- Render validated `tentativeCandidates` as structured interpretation data alongside the generated answer. Keep each candidate separate from `PackageData`, the OCR parser and calculations; model interpretation is not independent verification.
- The authorized 3.8 synthetic text request returned HTTP 503 after model listing succeeded. Stop the bounded run on this response; no retry, vision request or paid fallback. Keep Gemini application calls disabled until the owner enables the chosen project and the live service is available.

## 22 October 2026 — use one consented OCR-plus-image interpretation request

- Keep the local OCR and evidence package as the default input. If the user separately opts into photo transfer, attach up to three automatically selected, locally resized package photos to the same assist call; do not require a second image-selection/call for the first visual pass. Text-only remains the default, and no photo is transmitted without that explicit choice.
- Keep all returned package readings tentative, linked to original OCR observations and separate from `PackageData` facts and deterministic calculations. Vision observations are stored as `origin: vision` with their capture provenance only. Never round-trip model output through the OCR parser.
- Bound the path to 900 KB per client-compressed image, three images, 2.7 MB combined sanitized bytes, 4.3 MB application body, 4.5 MB provider contents and the existing response/output/deadline limits. Preserve explicit paid authorization and do not retry the observed free-tier HTTP 503.
- This is a feasible integration path, not an accuracy finding. It remains unverified with a live model until the provider returns a response; model candidate quality and photo-assisted recovery must be compared on the same annotated products before changing confirmed-read policy.

## 22 October 2026 — keep image-only model readings tentative and image-bound

- Extend the existing assist output contract to allow a candidate or claim to reference either exact OCR spans or an image whose bytes were included in that same provider request. Validate image IDs at both the provider boundary and the inference validator; metadata-only local handles do not authorize visual claims.
- Preserve model-reported visible text and optional normalized image region as unverified evidence. Numeric checks can compare the model's stated number against that same reported text, but this is not independent visual verification. Keep model candidates out of confirmed package facts, the OCR parser, and deterministic calculations.
- A single free-tier `gemini-3.8-flash` text-only run on the real Maggi OCR transcript returned HTTP 503 after 10.012 seconds, with no output or token usage. No image, profile, conversation or paid project was sent. Keep the current 16/16 local nutrition baseline as the scored result; Gemini is not scored. The app stays disabled until its owner enables it.

## 22 October 2026 — bound retries to free-tier 503 recovery

- The current `@google/genai` SDK counts `retryOptions.attempts` including the original request; `1` means no retry. Google's API guidance classifies 503 as temporary service overload/unavailability and recommends exponential backoff.
- Permit at most two total attempts for a free-tier application request, retrying only HTTP 503 once after a short jittered delay. Keep paid application calls and synthetic benchmark probes single-attempt. The paid path stays single-attempt so the local spend ledger's one-call reservation cannot undercount a duplicated paid provider attempt.
- This change does not enable Gemini or make another provider request. Verify retry behavior offline with a stubbed fetch; don't count a mocked 503→success as live provider acceptance.

## 22 October 2026 — store scanner edits as parameters against immutable originals

Keep each scanned side's original image immutable. Persist normalized crop corners, rotation and enhancement parameters plus an edit-history cursor; regenerate previews and OCR-ready images from the original for every revision. This allows crop revision without cumulative transform loss, exact Reset, reversible Undo/Redo, and Cancel that discards only the draft. OCR signatures include the saved revision so stale results cannot survive an image edit. Verified with touch interaction on portrait and landscape package photos; no OCR accuracy claim.

## 22 October 2026 — use The Thread as the primary application layout

- Use one responsive `100dvh` workspace for both the empty start state and active package conversations. Keep scanner editing in its existing modal. Put package sides, answers, compact deterministic calculations and follow-up input in the main thread; keep detailed observations, corrections, source records and research controls in a collapsed inspector.
- Require one user-selected goal during first-run setup while leaving medical and other sensitive disclosures optional. Keep context tab-scoped by default; device persistence is a separate opt-in. Keep Gemini profile sharing separately consented and disabled by default.
- Show only calculations supported by current package facts. Preserve dashes for missing values, state that OCR readings are not independently verified, and keep tentative model candidates out of calculations. The current portion card is deterministic; a model-selected generative component system remains follow-up work.
- Gemini is unavailable in the current session. Local results remain visible without silently substituting them for a missing model response, and no provider call was made for this checkpoint.

## 22 October 2026 — preserve correction provenance in the chat nutrition table

Treat edits to a label reading as user corrections, not verification. Keep the original OCR/text observation and correction in the package evidence graph; require a user-entered positive printed basis amount and unit when none is already recorded; never substitute the package serving size for a missing nutrient basis. Recalculate deterministically from the updated package, cancel in-flight model work, and visibly note that prior conversation answers may reflect previous values. The first thread component is a controlled data table; model-selected typed UI instructions remain a separate pending integration.

## 22 October 2026 — only offer an OCR photo-region link when lineage is intact

Expose an evidence-inspection action from a nutrition reading only if its OCR-origin observation retains an image ID, bounding box and run ID that resolve to the capture and in-session image. Rebuild and dimension-check the prepared image before drawing the region. This gives users direct visual context without adding a second image pipeline or uploading the photo; text-only evidence and stale references remain text-only.

## 22 October 2026 — expose label OCR evidence in the selected Thread direction

Keep ingredient, allergen and claim groupings visibly provisional. Surface all currently grouped observations and otherwise-unrepresented OCR lines in a collapsed Thread panel, preserving source-side/image links and the original observations. Do not treat the parser's grouping as verified meaning or convert it into a confirmed package fact. Do not truncate the ordinary Thread to a handful of ingredient fragments. Keep manual corrections separate from OCR and model interpretations.

Keep the active application as a viewport-sized workspace with internal conversation scrolling; constrain document-level overflow so the mobile composer and package context do not drift. Give the full-screen scanner modal a screen-reader-visible title even when its visual header is compact. Use named button/group semantics for side thumbnails and meet contrast on compact source labels.

## 22 October 2026 — allow typed, evidence-bound component choices in assistant replies

- Permit an optional bounded list of allowlisted UI component instructions in the existing assist output. Validate all referenced IDs against the supplied package, calculations and evidence; require a supported user-context claim for a personalized finding. Drop unavailable and duplicate components. The model can select presentation, but all rendered content comes from existing trusted app data and components.
- When an answer requests the editable nutrition table, render the existing `NutritionTable` inside that answer and hide its duplicate in the package summary. Without a model component request, keep the current table placement. The portion calculator always uses the existing deterministic audit calculations; user edits preserve observation lineage and invalidate prior model output as before.
- Include a community product record in model context only after explicit user selection and only without a package identity conflict. Attribute the source and retain its variant/coverage limitations; never treat it as verified manufacturer data.
- Conversation-history opt-in may persist generated answers and typed presentation IDs locally, excluding photos and profile fields. The privacy copy names that behavior. Gemini remains disabled until owner configuration/authorization; mocked UI acceptance proves only rendering and local deterministic behavior.

## 22 October 2026 — allow strictly OCR-grounded interpretations to support labeled arithmetic

- This supersedes the earlier blanket exclusion of tentative candidates from calculations only for nutrient candidates whose label, exact printed number, unit and basis each link to current raw OCR words, a matching OCR capture, and aligned row/column geometry. Image-only readings, unresolved fields, contradictory candidates and conflicts with package facts remain unusable; user corrections retain precedence.
- Calculations preserve the candidate ID and original OCR observation IDs, and the conversation, nutrition table and portion calculator mark the result as an unverified interpretation. This allows supported table reconstruction to become useful without mutating confirmed package observations. Synthetic offline tests establish the guard behavior only; no live Gemini output or photo accuracy is claimed.

## 22 October 2026 — show relevant source context in local conversation turns

- A local reply may include only context findings whose source IDs exist in the current audit and pass the existing safe-URL and bounded conversation-source schemas. Show that context when the question asks for guidance, comparison, health relevance or a source-backed calculation; keep quantity-only and uncertainty replies focused. Never infer applicability from retrieval alone.
- After a new local or Gemini turn, align the latest conversation turn at the top of the chat viewport so the question and answer opening remain visible. Honor `prefers-reduced-motion`; keep the independent nutrition and evidence controls scrollable below the conversation.

## 22 October 2026 — make public product lookup explicit and provenance-aware

- Put the Open Food Facts action in the package context within The Thread. It runs only after a user click and sends only the current barcode or product query; derive its disclosure from observation provenance so user-origin names are not mislabeled as OCR. Never attach photos or profile fields to this catalog request.
- Keep returned records marked as community candidates with regional variant, label-date, completeness and local-stock limits. Do not merge catalog values into photographed package facts. Offer comparison only after explicit selection and only when package identity is not disputed.

## 22 October 2026 — allow validated OCR-linked interpretations to fill comparison gaps

- For an explicitly selected community-record comparison, a complete OCR-linked model interpretation may supply a missing package nutrient or fill a missing basis for one observed value when its exact value and unit agree. The reconciler must validate label, number, unit, printed basis, source run and row/column geometry. Inconsistent interpretations, corrected/conflicted rows and disputed identity stay blocked; package readings and user corrections keep precedence.
- Keep this as ephemeral comparison input, never a package fact. Show its model origin, unverified status and OCR/image trace at the point of use. This applies the existing interpretation contract without changing shared schemas or Gemini provider behavior.
- Enable the explicit record-comparison action when at least one such reconciled reading exists, even if `PackageData.nutrients` is empty. Keep identity-conflict gating in both the action and comparator.

## 22 October 2026 — report retained but unparsed ingredient OCR honestly

- If an OCR line contains an explicit Ingredients heading but the parser yields no structured ingredient statement, the local response should describe an unresolved parsing gap and link that raw observation. Do not say the label has no readable ingredient text, and do not treat the raw line as a confirmed ingredient list.
- Keep the conditional Paddle fallback as an experimental path for now: this two-photo development run added 1 usable parser reading (0/10 to 1/10) at a 91 s cold-start and 31.2 MB of model GETs. The result is not enough to justify broader routing or a production-quality claim; evaluate varied, independently annotated Indian product groups before changing the architecture.

## 22 October 2026 — configure Gemini locally without enabling paid calls

Use stable `gemini-3.8-flash` through the explicitly selected free project for the local consumer path. Keep per-action consent, photo-transfer disclosure, profile opt-in and the local-only alternative. Google documents 3.8 Flash as stable and multimodal; its free tier has no token charge but may use submitted content to improve products. Keep paid access off until separately authorized.

For the current Gemini Developer API `models.generateContent` SDK path, use `responseMimeType` and `responseJsonSchema`: `responseFormat` is not supported by Gemini API and the installed SDK omits it from the serialized request. Revisit this only with a tested migration to a compatible endpoint. Mocked wire verification is not provider acceptance.

## 23 October 2026 — Do not equate Gemini configuration with availability

A configured key and enabled model are not proof of a successful provider call. The owner later authorized one bounded paid synthetic attempt; it returned HTTP 429 after 1.45 seconds, with no provider model or token receipt. Do not spend another attempt while that project remains rate- or quota-limited. Do not claim live readiness until an authenticated request returns a validated response with usage/model metadata.

## 23 October 2026 — Include validated local retrieval for unsupported Gemini questions

For a question the deterministic local audit cannot answer, query the same-origin curated evidence index with only the bounded question and include up to three returned sources in Gemini's existing validated evidence context. Share an in-flight lookup with the local evidence panel. If retrieval fails, continue without retrieved sources; never imply a match proves applicability. Keep provider availability and grounded-answer quality unverified until a successful, receipt-backed Gemini response.

## 23 October 2026 — Stop paid Gemini retries after repeated 429

The owner-authorized paid test is capped at $1 and four Gemini 3.8 Flash generation requests. Two paid attempts have reached Google and returned HTTP 429 without a model/token receipt; the usage ledger reserves $0.0528705, while actual billing is unknown. Do not retry until the configured Google project's quota and billing state are checked. Keep the normal `.env.local` selection unchanged; paid settings were limited to a stopped local test server. The real two-photo request verified consented request assembly and safe failure behavior, but did not produce a model interpretation.

## Gemini response budget and validation — 23 October 2026

Use gemini-3.8-flash with the official @google/genai GenerateContent tool loop and structured JSON output. Google documents function calling, structured output, and a 64K-token output maximum for this model (model capabilities: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash; structured output with tools: https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Keep NutriScan's per-generation output bound at 12,000 tokens and request concise evidence spans without repeated OCR lines; real two-photo calls reached both 5,993/6,000 and 8,993/9,000 before the bound was raised. The current configuration uses the $4.20 conservative spend cap and a 400-call ceiling, within the owner-approved ₹500 project budget. Use full local Zod validation and evidence checks. Gemini-enforced maxItems constraints were rejected for this nested response schema and remain disabled. Do not exceed the owner-approved project budget without further authorization.

Synthesis safety checks should reject definitive personalized safety/suitability verdicts and treatment directives, while allowing evidence-linked limitations that mention dose or exposure. Package facts and model candidates remain distinct; this change does not authorize medical conclusions or automatic confirmation of visual readings.

## Gemini tool-loop and paid usage accounting — 23 October 2026

Keep Gemini 3.8 Flash as the current paid development model. Preserve complete server-side Search call/response parts when continuing a multi-step tool turn, count Search queries from grounding metadata or echoed tool calls, and downgrade only invalid model image coordinates to withheld regions. Never turn out-of-bounds coordinates into normalized image evidence. Normalize grounding text for presentation, but do not label generated Search-grounded segments as direct quotations or independently reviewed source text.

The owner authorized development within ₹500. The local guard is $4.20 and 400 calls, with a conservative $0.014-per-search-query upper bound when the monthly Search free allowance may be exhausted. The current 23 October ledger snapshot is $2.9881145 committed estimate including failed reservations; token and Search estimates are not billing receipts. Continue to omit profile fields unless the user separately opts into cloud sharing.

EFSA OpenFoodTox 3.0 is a local structured lookup for substance identities and assessment reference values. Keep the CC BY-ND source and derived index under ignored `.data/`, preserve the pinned release/checksum and provenance, and do not vectorize or redistribute extracted tables. Identity or an ADI does not establish package presence, dose, consumer exposure, or individual safety.

## Gemini agent request duration and follow-up context — 23 October 2026

The server agent has a bounded 110-second wall-clock budget and each provider generation aborts after at most 65 seconds. Set the assist route `maxDuration` to 120 seconds and the browser abort to 125 seconds so ordinary tool sequences can return their final response. Keep model-produced package candidates separate from confirmed package data, and retain prior candidates when a follow-up supplies no replacement candidates; a missing candidate array is not a correction or retraction.

## Exact regulatory identifier retrieval — 23 October 2026

When a regulation query explicitly names an INS code, require that exact code in the extracted source text and center the bounded excerpt on its occurrence. If it is missing, keep the official source link and report no text match; never substitute a nearby additive row. Flattened PDF text remains unverified and may not preserve table columns or category inheritance. FSSAI Appendix A stays labeled as a navigation aid, while the underlying notification, effective date, exact food category and later amendments remain necessary for any legal conclusion.
