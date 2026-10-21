# Chronological decisions

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

## 21 October 2026 — verify keyboard intake and result navigation

- Added `npm run acceptance:keyboard-application` to traverse first-visit controls and the text-only result state with Chrome keyboard input at 390×844 and 1440×900. The test opens the label dialog with Enter, enters text, submits from the keyboard and verifies focus containment and return to its trigger.
- Full tabbable traversal covered 11/11 first-visit and 22/22 result controls on mobile, and 13/13 and 24/24 on desktop. All stops had accessible names; no axe violations, page errors or off-loopback requests occurred. This is scoped intake-to-result coverage, not proof of every research state, screen-reader or WCAG conformance.

## 21 October 2026 — externalize PDF.js for live regulation extraction

- Live route probes showed that `pdfjs-dist` worked in a direct Node diagnostic but every PDF parse failed inside the Next.js route. Next.js 16's bundled package-bundling guide documents `serverExternalPackages` for dependencies that need native Node loading; externalizing `pdfjs-dist` restored extraction from the official, selectable-text FSSAI 2024 ORS order.
- The 2022 direction and the 2024 order are extractable, and the 2024 order is explicitly labeled superseded by the 14 October 2025 withdrawal. Raising the per-source bound from 1.2 MB to 2 MB admitted the 1.65 MB 2022 PDF. The scanned 2025 PDFs still have no selectable text and court-PDF extraction varies across route attempts. Preserve direct links and explicit unknown status; do not infer a current rule from historical sources.
- A mobile/desktop Chrome run also found long legal identifiers forcing 10 px horizontal overflow on mobile. `overflow-wrap:anywhere` on research cards removed page overflow; Axe and page-error checks remained clear. Receipt: `docs/evidence/regulatory-research-browser.json`.
