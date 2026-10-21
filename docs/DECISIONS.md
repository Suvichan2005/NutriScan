# Chronological decisions

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
