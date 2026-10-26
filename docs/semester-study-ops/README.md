# ThinkBook study operations

This companion operates alongside the existing queue, experiment manifests, annotation contracts and nutrient scorer. It does not replace them or modify production inference. Python 3.11+ standard library only; no npm installation, provider call, downloads or image decoding required.

## Candidate readiness

From the study worktree:

```powershell
python tools/semester-study-ops/study_ops.py readiness --collection ../NutriScan/.data/semester-evaluation-acquisition-20261026/collection-manifest.json --evidence-root ../NutriScan
```

Optional `--reviews <private-review-index.json>` supplies custodian attestation metadata. Top-level `groups` is keyed by `productGroupId`. Each record has: `familyReviewComplete`, `rightsDecision` (`approved-local-study`), `variantId`, `packagingRevision`, `split` (`development`/`calibration`/`held-out`), `splitLocked`, `previousModelExposure`, `readerPasses`, `adjudication`, and `referenceCoverage`. Each `rightsReview`, `variantReview`, `marketReview`, `layoutReview`, `exposureReview`, and `splitReview` is `{path, sha256}` relative to the explicit evidence root. Reader passes add `reviewerCode` and `independentHuman:true`; adjudication adds a distinct `reviewerCode` and `unresolvedDisagreements`. Required coverage keys: nutrition, ingredients, allergens, additives, warnings, claims, serving, identity. Values are `human-reviewed-present`, `human-reviewed-absent`, or `human-reviewed-unreadable`.

The tool hashes immutable pass files but never parses hidden labels. It cannot authenticate that a declared reviewer is human, confirm rights or establish reference quality. A custodian must verify those declarations independently. READY means metadata intake ready only; final execution still uses the existing `run_experiments.py` final freeze gates and annotation schema validators.

## Human response review

Prepare private response records containing exact `responseId`, authoritative `conversationId`/`turn`/`questionSha256`, `buildCommit`, `contextSha256`, `responseSha256`, `displayedResponse`, `status:completed`, `treatment:knowledge-on|knowledge-off`, and `sourceReceipts` (explicit empty list allowed). Include `contextArtifact:{path,sha256}`: a human-approved UTF-8 context file with the authorized package/profile/history and exact question. Its raw file hash must equal contextSha256. Do not put hidden annotations or disallowed profile data in reviewer context. Source receipts should have secrets removed before export.

```powershell
python tools/semester-study-ops/study_ops.py export-review --responses .data/study/response-records.json --evidence-root . --seed 20261026 --output .data/study/review-batch-01
```

This creates a fresh `reviewer/` directory with plain Markdown packets and blank JSON rating forms: no app installation or Gemini is needed. Share only reviewer files with authorized reviewers. Keep `custodian/join-key.json` and original treatment/build records private. Explicit arm/build labels are removed; source content may still reveal treatment, so do not claim perfect blinding. Preserve reviewer originals and use separate copies for reader A/B. Never send the custodian key to reviewers.

For actual ratings:

```powershell
python tools/semester-study-ops/study_ops.py ratings --ratings .data/study/returned-ratings.json --key .data/study/review-batch-01/custodian/join-key.json
```

Nine dimensions come directly from semester-experiments.json. Human rows require pseudonymous raterCode, provenance independent-human, timezone-aware assessedAt, all nine integer 0–4 scores or genuine N/A with reasons, evidence pointers, and a critical-error list. Blank scores stay pending. A second reviewer never automatically becomes adjudication. Raw scores/disagreements remain separate from final conclusions; this tool reports per-response summaries, not a study-wide scientific score.

## Knowledge pair comparability

```powershell
python tools/semester-study-ops/study_ops.py pairs --responses .data/study/response-records.json
```

Checks the nine declared first-turn pairs. Both records additionally need exact model, generationConfigSha256, basePromptSha256, packageSnapshotSha256, toolManifestSha256, fallbackOccurred:false and externalKnowledgeCalls. Context, package, question, build, model and generation/base prompt must match; tool manifests remain separate. Knowledge-off must report zero external knowledge calls. These declarations require corresponding transport/tool receipts before a final claim.

## Checks

```powershell
python -m unittest discover -s tools/semester-study-ops -v
python scripts/evaluation/validate_semester_inputs.py
```

All bundled tests use explicitly synthetic structural data. They do not produce genuine reviewer ratings or package accuracy results. Private artifacts belong under ignored `.data`; no original photos, response bodies, reviewer identities or answer keys belong in Git.

Additional operational interfaces: `RECEIPTS.md` documents the existing-runner comparison wrapper and proposed binding extension; `STAGING_READINESS.md` records actual remote-host blockers and reviewer acceptance; `REPORT_EVIDENCE.md` documents the actual-template audit and stale source anchors. Keep these workstream notes subordinate to the master completion queue.

`ADJUDICATION.md` covers immutable reader disagreement packets and explicit human adjudicator records. It preserves N/A disagreements and every critical-error disposition; unresolved decisions stay pending.

## Offline reviewer form

`export-review` now includes `reviewer/review.html`. Open it locally to read the authorized frozen context, response and source receipts, then enter nine scores, evidence pointers, critical errors and your own reviewer code. Completed assessments export as the same JSON accepted by `ratings` and adjudication; incomplete assessments remain pending. Device storage is off by default and optional; Restore saved draft and Remove saved draft are explicit. Export before closing if device storage is unavailable. Keep the whole packet private and share only with authorized reviewers.

No external scripts/fonts/images or network requests are used. Package/model text is rendered as plain text, never HTML. A content security policy permits only the authored script hash and denies network access. The export generator excludes custodian treatment/build labels from reviewer packets, though source content can still reveal treatment. Browser file-origin storage/download behavior varies; verify in the reviewer's intended browser before collecting real ratings.

Current verification: Python injection/CSP checks, JavaScript syntax, and a synthetic-DOM script integration check cover navigation, pending exports, N/A reasons, malformed critical-error JSON, draft persistence and export Blob contents. The resulting synthetic exported row is accepted by the existing rating validator and correctly remains pending for second review. **Actual browser visual, storage and download acceptance is BLOCKED because local browser use is disabled in Work settings.** No browser acceptance, real human rating or scientific outcome is claimed.

## Preparing the retained real-provider development portfolio

```powershell
python tools/semester-study-ops/prepare_development_review.py --original-root ../NutriScan --output .data/study-ops/development-review-next --allow-development-context
```

This importer supports only the existing exposed semester conversation pilot. It checks all nine exact scripted cases, package snapshot hashes, response/question identities, logical-turn accounting and source-file stability. It recreates the archived runner's bounded history and exports26 real retained server responses plus an explicit record of the missing27th response, without provider calls. A fresh private output is required outside the read-only original corpus.

The returned answer is labeled server-returned, not observed browser rendering. The packet prominently says DEVELOPMENT and package facts not independently human verified. Contexts include fictional profiles and model-assisted package readings; reviewers must not treat them as gold labels. No treatment/no-knowledge pair or human ratings are invented. Source inputs and historical runner bytes remain hashed in manifest.json. Keep both contexts and custodian metadata private; share authorized reviewer material only after custodian review. The generic reviewer form still requires actual browser acceptance.

Actual preparation26 October:26 responses, A-D turn3 `provider_incomplete` retained,0 returned source records among26 answers. Archived completed-call usage:33 generations,235161 prompt/4351 output tokens,4562 thinking tokens reported in17/33 calls,18174 cached prompt tokens reported in4/33 calls. Missing thinking/cache fields remain unknown. Recorded estimates total$0 for these free calls; billed cost and failed-request usage remain unknown. Initial reconstruction cost excluded. This is retained development evidence and does not establish scientific answer quality or final study success.

## Retained development operational tables

```powershell
python tools/semester-study-ops/summarize_development.py --pilot ../NutriScan/.data/semester-conversation-pilot-20261026 --output .data/study-ops/development-operations-next
# Run using the bundled report Python with Pillow:
python scripts/evaluation/generate_report_evidence.py --manifest .data/study-ops/development-operations-next/report-manifest.json --out .data/study-ops/development-operations-next/report-generated
```

The first command validates the27 logical turns against exact authoritative scripts and reconciles each summary with its original response/failure receipt. It writes per-turn.csv, operational-summary.json and a manifest for the unchanged existing report generator. Every source input remains hash-linked and stable after reading. The second command verifies metric JSON pointers/hashes and generates existing CSV/PNG/SVG report artifacts. Use a fresh output each time; original files remain read-only.

Actual artifacts: `.data/study-ops/development-operations-verified-20261026/`. Retained run metrics:26 completed/1 failed;33 completed generations;10 tool calls;0/26 answers with returned sources; median completed direct-assist task5757.5ms, range2611–28099ms;8 withheld quantity sentences. No nutrient/answer accuracy score or independent result is produced. Assistant-task time is not browser/full-scan latency. Failed-call usage and initial reconstruction cost remain outside these completed-generation totals and must not be silently described as free/zero. Historical free estimates and actual billing are separate.

The generated median figure was visually inspected for readable labels and development-exploratory scope. These are individual operational receipt figures, not final scientific comparison plots. Human reference/rating results remain PENDING.

## Custodian candidate intake without copying originals

```powershell
python tools/semester-study-ops/custodian_intake.py --original-root ../NutriScan --output .data/study-ops/custodian-intake-next
python tools/semester-study-ops/study_ops.py readiness --collection ../NutriScan/.data/semester-evaluation-acquisition-20261026/collection-manifest.json --evidence-root ../NutriScan --reviews .data/study-ops/custodian-intake-next/reviews.json --review-root .
```

The intake creates per-group metadata sheets, a fully unfilled reviews.json and before-review readiness. It links existing annotation-batches/index.json instead of regenerating a second assignment system. The explicit `--review-root` lets human receipts live in the study workspace while the original image/reference corpus stays read-only under `--evidence-root`; each root is independently path-bounded. No photos or answer labels are copied, decoded or prefilled.

Actual prepared packet: `.data/study-ops/custodian-intake-20261026/` contains12 candidate sheets/23 original pointers and reuses46 nutrition plus46 supplemental reader assignments. All approvals/references/splits remain pending. The original HUMAN_HANDOFF.md still says10 groups, while the later collection manifest and annotation index consistently say12. Its historical text was preserved; use the latter hashed manifests for current accounting and have the custodian reconcile human eligibility. Counts are not final-study acceptance.
