# NutriScan release candidate and ThinkBook handoff — 27 October 2026

**Authoritative release:** `nutriscan-rc-20261027` on `codex/generalized-package-intelligence-wip`. Resolve its exact immutable commit with `git rev-parse 'nutriscan-rc-20261027^{commit}'`; the release notification also supplies the full SHA. This tag includes this handoff. The application source validated below is `342bff38c5d3494c678c5060fe32de6e6130c941`; subsequent handoff-only changes have the identical application manifest digest `52d4bb295b5dd7adf77b70b7e3966a4362cf9ee6d8b3fd09c8524a9ad0fef6f7`.

Production engineering is frozen. IdeaPad is the sole application integration owner. ThinkBook owns experiment operations, measurement, final report and presentation. Subham's absence and unavailable independent ratings do not block this technical handoff. A poor experiment result alone does not reopen implementation. A demonstrated safety, integrity or release blocker requires a new release tag and explicit notice that this candidate is superseded. Main and public deployment are unchanged.

## Consolidation and verification

PR #3 is merged into the integration branch as `bfbb377391ebf59a705eb8676db2f87cc9e42329`; it is an ancestor of the candidate. Blocker fixes are `65e724e` (new-topic context isolation and adapter metadata compatibility) and `fbc045a` (explicit private study response retention, including failed validation). [Reconciliation](RELEASE_RECONCILIATION.md) classifies the older branch's distinct improvements. Its `da728ef` history is archived, not another production version. Unseen ThinkBook recovery patches are not assumed integrated.

The final clean-source worktree passed **885 tests, 2 skipped, 0 failed**, full TypeScript validation and optimized Next build. Its installed direct dependency versions match every pinned package requirement. Dependencies were reused locally; a fresh `npm ci` acquisition was not rerun. Study compatibility passed20 focused checks,12 Python runner checks and the existing five-arm/nine-conversation/27-turn preparation check. The independent autoreview for `fbc045a` was scoped clean at P0/P1; it did not execute code. These are engineering results, not accuracy or science measurements.

Public sanitized receipt: [release-acceptance-20261027.json](evidence/release-acceptance-20261027.json). Full test/build logs, source manifest and private browser artifacts: `.data/release-candidate/20261027-c15f77d/`. The directory name records the starting checkpoint, not the final source identity; use its recorded hashes and the public receipt.

| Required journey | Actual accepted outcome / scope | Evidence |
| --- | --- | --- |
| A — real package photograph | Real authorized development photograph, installed Chrome at390×844 and1440×900. Local OCR kept10 original OCR observations through reopen; absent sodium remained unknown; missing-value editor reachable and blank. Identity stayed generic. This realistically weak OCR result is accepted abstention/recovery behavior, not successful nutrient extraction. No live Gemini reconstruction was available. | `browser/real-photo/ocr-photo-receipt.json`, `390x844-real-local-ocr*.png`, `1440x900-real-local-ocr*.png` under the private release directory. |
| B — correction and two portions | Retained accepted850→900mg/100g correction,450mg/50g, then225mg/25g after reopen. Original850 reading and user provenance retained; saved profile/photos absent. Missing-row editor acceptance also covers450mg/100g→135mg/30g, selected unit/basis, original carbohydrate evidence and reconstructed/local routes. These unchanged editor flows were reused, not repeatedly rerun. | `.data/ideapad-restoration-20261026/restored-journey.json`; preserved missing-row receipt at `prior-browser/real-photo/receipt.json`; original03f95b0/a86a340 checkpoints. Synthetic/intercepted API flow evidence. |
| C — claims, allergens, health context | Fresh final-candidate browser sequence checks ingredient/allergen wording, sugar-free versus carbohydrate, missing calcium, independent allergy/diabetes question, and sodium/whole-diet guidance. New question no longer inherits calcium. WHO population reference is qualified and source-linked; no personal allowance/suitability conclusion. | `browser/local-breadth/receipt.json`, `mobile.png`, `desktop.png`;0 provider/external requests, page errors, Axe findings or overflow. Synthetic label/profile, deterministic local answers. |
| D — multi-turn and saved continuation | Portion changes, short contextual follow-up, correction invalidation and save/reopen are covered by the retained correction receipts and current context/provenance suite. Selected tool evidence transfer is verified by the mocked production request regression. Existing reconstruction avoids resending photos. Retrieved-only records stay distinct from citations after save/reopen. | B receipts; `src/lib/__tests__/conversation-context.test.ts`, `server.test.ts`, `analysis-method.test.ts`; missing-row reconstructed receipt. Genuine model adherence remains unverified. |
| E — provider/cloud/OCR failure | Fresh desktop/mobile mocked503 preserves useful typed calculations and offers explicit retry. Real incomplete OCR and disabled cloud retain evidence and a bounded unknown answer. Previously accepted mode-switch retry and provider timeout/route tests remain. | `browser/failure-recovery/receipt.json`; screenshots `docs/evidence/private/m6-provider-failure-recovery/`; `docs/evidence/m6-retry-recovery-20261027.json`. Interception never reaches a provider. |

Six final screenshots were visually inspected across real-photo, local-answer and recovery states. The current browser matrix has zero provider/external requests, page errors, Axe violations or horizontal overflow. An Axe pass is not full screen-reader/WCAG certification.

## Reproduce the application

Tested runtime: **Node24.22.1, Next16.4.2, React19.3.1, TypeScript7.0.2, Vitest5.0.5**, Windows and installed Chrome. Package requirements declare Node≥22.13; use the tested Node version for research. Native SQLite readers require a compatible Node runtime. Install the complete locked dependency set for build/research; do not omit development dependencies before preparing OCR assets.

From a clean clone, with a standard Node/npm installation:

```powershell
git fetch origin --tags
git switch --detach nutriscan-rc-20261027
npm ci
# On a new checkout only; keep all remote/provider flags false for the local demo.
Copy-Item .env.example .env.local
npm run build
npm run start
```

The server binds127.0.0.1:3400. Use another free local port with `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3415`. On Windows the build launcher defaults `GOMAXPROCS=2` for the TypeScript7 Go checker; an explicit override is respected. Root owner server/state are not release inputs. The clean validation worktree `.data/release-validation/` excludes all five owner overlays; their exact original bytes remain preserved in `.data/release-candidate/20261027-c15f77d/owner-files/` and in the primary checkout.

For a demo: open a fresh browser context; select local-only in Details and settings → Advanced analysis settings; attach an authorized development photograph; inspect Package and Sources & OCR; add/correct a printed nutrient with its actual unit/basis; ask two portions; choose Save chat; reopen from history. Images are available in the active scan, while saved records preserve observations, lineage, corrections and conversation rather than original photo bytes/profile. Reattach photographs when a later visual inspection requires them. Local label text is an explicit recovery path. Fresh provider demos require explicit consent and usable free quota.

Representative reproducible checks, with a loopback server running:

```powershell
npm test -- --maxWorkers=1
$env:NUTRISCAN_BASE_URL='http://127.0.0.1:3415'
npx tsx scripts/acceptance-local-breadth.mts
npx tsx scripts/acceptance-provider-failure-recovery.mts
# Real-photo check requires the private authorized input; it is not in Git.
$env:NUTRISCAN_OCR_PHOTO_PATH='C:/private/authorized-development-label.jpg'
npx tsx scripts/acceptance-missing-nutrient-ocr.mts
```

## Five methods, assets and source availability

| Arm | Exact `analysisMethod` | Initial reconstruction evidence |
| --- | --- | --- |
| A | `tesseract-text` | Selected latest Tesseract text/layout observations, no images |
| B | `paddle-text` | Selected latest Paddle observations, no images |
| C | `vision` | Selected full photographs, no OCR or earlier parsed/corrected facts |
| D | `tesseract-vision` | Selected Tesseract observations and full photographs |
| E | `paddle-vision` | Selected Paddle observations and full photographs |

Default remains `tesseract-vision`. This is a supported configuration, with no claim of comparative accuracy superiority. The5-method routing/initial-stage tests use controlled provider responses; the final comparative experiment has not run. Implementation: `src/lib/analysis-method.ts`, `src/lib/server/analysis-method.test.ts`, `reconstructPackageForEvaluation()` in `src/lib/server/gemini.ts`.

- `npm ci` runs `scripts/prepare-ocr.mjs`: copies Tesseract worker, English trained data and WASM plus Paddle ONNX runtime from installed packages to ignored `public/ocr/`. Those runtime files are installed on IdeaPad. Tesseract local OCR is English only.
- Paddle weights are fetched on first use by the established browser reader; runtime assets alone do not prove those weights are cached or that every engine has genuine-photo acceptance. Disclose/prewarm its existing download path before a timed study; do not mix download/startup time silently with steady-state inference.
- Tracked curated source records, `data/semantic-index.json`, `data/foodon-index.json` and declared source roles are installed. Optional MiniLM cache exists at `.data/models/Xenova/all-MiniLM-L6-v2`, pinned by `data/semantic-model-manifest.json` to revision751bff37182d3f1213fa05d7196b954e230abad9. It was linked into the validation checkout; preserve the manifest hashes when transferring it.
- Rich private runtime stores are **absent on IdeaPad**: `.data/knowledge/foodon-records.sqlite`, `.data/knowledge/openfoodtox-3.0.sqlite`, `.data/food-composition/fdc-source-records.sqlite`. Their rich-record calls must be recorded unavailable; tracked concept/index/curated evidence is not the complete database. Do not claim all21 sources are fully installed. ThinkBook must freeze the same source asset set across paired conditions, either preserving its approved stores or recording this unavailable set.
- Open Food Facts, Europe PMC and official regulatory discovery are bounded explicit remote tools with service-dependent availability. Source provenance is retained; navigation links and Google grounding links are not reviewed publisher excerpts. No bulk acquisition is part of this release.

## Controlled experiment interface

Routine application metadata contains no private questions, profiles, images, OCR, tool payloads or answers. `NUTRISCAN_GEMINI_EVAL_CAPTURE=1` works only in local development and enables metadata, not readable app transcripts. The separate explicit study adapter writes controlled outputs into the already secured ignored per-run directory. Existing legacy private transcripts remain historical and must not be treated as fresh-release results.

Runnable preparation/runner checks, without providers:

```powershell
python scripts/evaluation/validate_semester_inputs.py
python scripts/evaluation/test_run_experiments.py
```

The final experiment config/inputs still require actual custodian decisions; their absence is an experiment-operation dependency. No ratings, annotations or references have been invented. The established generic runner remains `scripts/evaluation/run_experiments.py`, with `prepare`, `freeze`, `execute` and `score`. A frozen final job must bind source commit, checked input/reference/adapter hashes, actual model/version and generation configuration. It rejects fallback, mismatched model/configuration/modality and contaminated initial reconstruction.

For an authorized reconstruction job generated from those frozen inputs:

```powershell
$env:NODE_ENV='development'
$env:NUTRISCAN_GEMINI_EVAL_CAPTURE='1'
# Configure only the authorized server-side FREE key/model in the private environment.
# ENABLE_GEMINI=true; ENABLE_PAID_GEMINI=false; ENABLE_PAID_GEMINI_FALLBACK=false.
Get-Content -Raw .data/study/job.json | npx tsx scripts/evaluation/reconstruct-initial.mts --allow-provider > .data/study/receipt.json
```

`job.json` is a real frozen runner job, not a synthetic reference substituted for held-out input. Its sole `reconstruction-input` file has a verified SHA256 and selected method. The adapter returns actual initial reconstruction, model/configuration, modality, tier/fallback, usage, latency, route attempts, metadata, input-file hash, selected-package-context hash and response hash. It writes `controlled-response.json` **before** normalization/validation, including source-reference aliases, excluding thoughts/signatures/images. Failed validation retains that file plus `controlled-failure.json`; the runner retains the adapter's failure JSON and still marks the job failed. `privateRecords[]` carries paths and byte hashes. Preserve these files with the receipt, never commit or publish their content.

For conversation collection, use the existing consented `/api/assist` contract (`assistInput` in `src/lib/server/gemini.ts`), fixed reviewed package snapshots and explicitly supplied fictional profiles. Save each full returned JSON privately: `answer`, current package revision, calculations, `agentEvidence`, `agentTrace`, `agentDiagnostics`, `diagnosticId`; hash the packet/response. Join provider calls/usage by analysis ID in `.data/gemini-usage.json` and metadata `events.jsonl`. Carry the prior actual user/answer turns explicitly; omit photographs for follow-ups using a saved reconstruction. A returned source is not automatically a citation, and a citation does not establish entailment. ThinkBook owns freezing its conversation collection adapter/configuration and the predeclared paired ablation; ordinary UI output is not a final study runner.

Free-first routing and3.8 Flash preference are preserved. Live generation was disabled during release acceptance; the last available development attempts included timeouts/free-model exhaustion. No new probe was needed to accept the deterministic implementation. **No feasible frozen provider model is certified by this release.** ThinkBook must perform one bounded free-only development feasibility check and freeze a usable actual model/configuration, or report provider-backed experiments blocked. Never silently substitute a model across matched arms. Usage/cost fields are SDK/local estimates, not billing receipts; missing usage is not zero.

## Implementation map and limitations

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Shared contracts: `src/lib/contracts.ts`; UI/session orchestration: `src/components/nutriscan.tsx`; corrections and lineage: `src/lib/reconstruction-correction.ts`, `src/lib/correction.ts`; arithmetic: `src/lib/portion.ts`; local conversations: `src/lib/conversation-context.ts`, `src/lib/followup-evidence.ts`; source boundaries: `src/lib/answer-evidence.ts`; provider/routes/tools: `src/lib/server/gemini*.ts`; study adapter/runner: `scripts/evaluation/`.

Known limits are frozen report inputs: weak/English-only OCR and unverified model readings; no measured engine superiority; absent rich stores; current free-provider availability/model adherence unverified; source-scope checks do not prove scientific entailment; no independent science ratings supplied; no clinical safety or current-law certification; no original photo/profile persistence in saved chats; no remote-host/public deployment acceptance; fresh dependency acquisition not repeated. None is presented as a successful final accuracy result. Existing private report draft/render artifacts remain untouched; ThinkBook owns its template, bibliography, figures and conclusions.

Remaining owner/research actions: retrieve this tagged release; provide the approved private assets and fixed study inputs; freeze a feasible provider configuration; execute/measure the established experiments when their inputs are ready; disclose absent human judgments and source coverage; complete report/presentation. Production feature development stops here.
