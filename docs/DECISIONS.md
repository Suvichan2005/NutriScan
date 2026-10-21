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
- Preserve the investigation, portion, chat and historical observations when new photo data is merged. Keep differing values on compatible bases and mark them as conflicts; never average or silently choose one. If a later barcode, brand or license observation conflicts, retain the observations and warning but clear the selected catalog identifier and leave the product search blank until the user resolves identity.
- Clear product-dependent remote findings when package evidence changes. Keep local conversation available. Browser interaction for this path remains unverified pending browser selection.
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
