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
