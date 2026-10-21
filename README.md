# NutriScan

Local-first packaged-food evidence workspace. A standalone Next.js / React / TypeScript application for reading labels, checking calculations and inspecting supporting sources.

## Run on Windows

Requires Node.js 22.13+ (developed with 24.4.1) and npm. The bounded Gazette-PDF text reader uses the pinned PDF.js Node build.

```powershell
npm ci
npm run embeddings:prepare
npm run dev
```

Open http://127.0.0.1:3400. `npm ci` copies the pinned Tesseract worker, WASM and English language file to `public/ocr/`. Fonts are bundled locally. Embedding preparation downloads a pinned, approximately 24 MB open model once into ignored `.data/models/`; runtime queries never download models or send query text to Hugging Face. Ordinary scans work without preparing embeddings.

```powershell
npm run typecheck
npm test
npm run evaluate
npm run ocr:evaluate
npm run embeddings:evaluate
npm run acceptance:core-journey
npm run build
npm start
```

Stop the dev server before `npm start` because both bind port 3400. `npm start` serves the production build on loopback only. The API origin gate is intentionally local-only; this is not a publicly deployable authenticated service.

`npm run ocr:evaluate` reruns a local diagnostic on five real packaging photos provisioned under ignored `docs/evidence/private/`. It verifies their manifest hashes and writes field-level results without storing photo bytes or raw OCR text. See [the evaluation report](docs/REAL_OCR_EVALUATION.md) for the measured limits; this Node diagnostic is not browser acceptance.

An optional French/Spanish model probe is available as `npm run ocr:evaluate:languages`. It requires separately installing the two language packages with the command in the evaluation report. They are not normal project dependencies and are not included in the browser app. A separate `npm run ocr:evaluate:regulatory-pdf` diagnostic checks local OCR on public scanned FSSAI PDFs; it requires Poppler (`pdftoppm`) on `PATH` or an explicit `NUTRISCAN_POPPLER_BIN` path. Its aggregate receipt is not integrated into the product or a verified legal transcript.

`npm run ocr:evaluate:preprocessing` compares local upscaling, grayscale and channel-isolation variants on one real label. See the recorded results before changing the production image pipeline.

## Use

Add up to 10 JPG, PNG or WebP images, use the camera affordance, describe a product, paste label text, or combine these. No image side is required. OCR reads the selected images locally at up to 3,000 px with progress and cancellation; optional per-image hints can guide it. Rotate, improve contrast, invert dark-pack text, or crop a chosen image. Ask a question in your own words before or after reading. The sample label is clearly synthetic. Values with unclear bases, columns or conflicting readings are withheld; manual correction remains available when a photo or record cannot resolve them.

Ask an amount in your first question or in a follow-up to set the portion without rescanning. Product comparisons normalize compatible package and community-record values only when both bases are explicit; missing or conflicting values remain incomparable. Evidence expands to original observations, coordinates, assumptions, formulae and sources. Public product and scientific queries are user initiated. Country filters use an explicitly entered country and community country tags; they never establish local retail stock. FDA records are US historical candidate reports, never a global brand verdict. FSSAI research uses bounded selectable-text extraction for allowlisted official PDFs and displays publication and effective dates separately. The live ORS route retrieves the 2022 direction and superseded 2024 order; the scanned 2025 PDFs need OCR, and current legal status remains unresolved. Separately, the listed 2026 Gazette amendment PDF currently returns HTML to the local research fetch and remains navigation-only.

Gemini is off. Copy `.env.example` to `.env.local` and configure an owner-authorized key, selected compatible model and explicit enable flag only when API usage/cost is approved. The UI requires per-investigation consent. Model-requested image handles/crops are resolved by the browser, with a separate visible send action. Provider paths have not been accepted against a real Gemini account. See [integrations](docs/INTEGRATIONS.md).

The optional profile starts empty and keeps dietary preference, food allergies, food intolerances, health context, goals and reference details separate. Profile information stays in session memory and is sent to Gemini only after the disclosed per-request consent. Read [status](docs/STATUS.md), [acceptance](docs/ACCEPTANCE.md), [UX audit](docs/UX_AUDIT.md), [privacy](docs/PRIVACY_DATA_FLOW.md), [owner actions](docs/OWNER_ACTIONS.md) and the [chronological engineering journal](docs/agent-journal/2026-10-21-generalization.md). No public deployment, remote Git repository or private journal bridge was created.
