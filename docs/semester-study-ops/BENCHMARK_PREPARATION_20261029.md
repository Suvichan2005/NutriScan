# Mission 1 — prepared dataset and reproducibility

Current machine-private package: `.data/benchmark-preparation-20261029-v1/`. Do not upload its photographs, source snapshots, package states, annotations or response material to Git. Production and report files are unchanged.

## Delivered

- 38 candidate product groups; 102 unique original files (131,718,367 bytes); 23 retained originals hash-verified and reused, 79 newly acquired.
- Eight metadata food strata. Proposed development/calibration/prospective-held-out allocation 20/7/11, blocked into 28 conservative brand families. All final rights/variant/exposure/layout decisions pending.
- Two reader assignment sets: 204 nutrition-pass assignments and 204 supplementary-text assignments; blank transcription sheets and distinct adjudicator queue. There are **zero completed human passes**, not 408 annotations.
- Original 9 conversations/27 questions, three actual Grade 3 package snapshots, offline production calculator oracles, 9 matched first-turn tool-policy pairs, 12 separate transfer cases and 24 unjudged retrieval questions.
- Existing runner/scorer gates retained. Supplementary literal text, CER/WER, official GriTS, state outcome and supplied atomic-claim checks. No automatic human/medical verdicts.
- Offline quality receipt, schema checks, same-input/context hashes, source catalogs and a versioned private archive.

## Read first

`BENCHMARK_PROTOCOL_20261029.md` and `data/evaluation/benchmark-protocol-v1.json` define the preparation protocol. Private `prepared-v2/readiness-summary.json`, `prepared-v2/product-readiness.csv`, `prepared-v2/ANNOTATION_README.md` and `prepared-v2/custodian/` identify actual work per group. `prepared-v2/contracts/` is the current instruction/source/tool/pair capture; the preceding capture is retained as preparation history. No model/configuration or formal final split has been approved.

## Reproduce offline checks

Use the repository-pinned Node/npm runtime. Python 3.12 was used, with the evaluation-only requirements in `tools/semester-study-ops/requirements-benchmark.txt`. Install these in a chosen isolated environment; the current private target directory is not portable and is excluded from the archive. PyMuPDF is AGPL/commercial licensed; it is not a production dependency. Preserve the pinned upstream GriTS source and MIT license.

```powershell
python -m unittest discover -s tools/semester-study-ops -p 'test_*.py'
python -m unittest discover -s scripts/evaluation -p test_run_experiments.py
node --check tools/semester-study-ops/acquire_benchmark.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

On this workspace, set `PYTHONPATH` to `.data/benchmark-preparation-20261029-v1/python-dependencies` for the installed evaluation-only packages. Production imports are not changed.

Use `benchmark_metrics.py <text|ocr-text|retrieval|state|atomic|grits> input.json --output new-result.json` for supplemental records. Inputs use the function names/fields documented in that module. Retrieval delegates to the established runner's graded 0–3 implementation. Nutrients continue through `scripts/evaluation/score-reconstruction.mts`. Human response ratings/blinding and receipt comparability use the existing study-ops tools. Empty/unjudged inputs cannot establish accuracy.

To rebuild assignments into a NEW version, use `prepare_benchmark.py --dataset <new-copied-dataset-root> --output <new-private-prepared-root> --legacy-root <retained-original-checkout>`. The source dataset root must have an untouched acquisition collection and no existing generated assignment files; completed references must never be overwritten. `capture_benchmark_contracts.mts <prepared-root> [new-contract-directory]` captures production contracts offline, with network disabled. It refuses existing output directories.

Acquisition is already complete. The bounded collector can be rerun only into a NEW directory with the original public catalog, retained collection and read-only original root; it refreshes official metadata and may produce different files later. It does not guarantee remote bytes stay unchanged. The current archived bytes and SHA-256 inventory are the authority. Do not repeat downloads to validate this package, disable TLS or claim source metadata is human truth.

## Remaining execution work, not performed here

The `reconstruction-cases.json` file is a hashed image inventory, and `blocked-final-preflight.json` enumerates 190 potential five-arm jobs. **These are not executable provider inputs yet.** The existing adapter requires one hashed `role=reconstruction-input` JSON. Real uncorrected OCR captures, production image preparation/size checks, exact per-arm raw payloads and model/configuration freeze occur in the later authorized execution mission; see `adapter-input-plan.json`. No missing OCR or hidden descriptions have been invented to make arms appear ready.

The independent protocol additionally needs actual rights/market/variant/exposure/layout approval, A/B transcriptions and adjudication, then locked product splits. Retrieval/answer quality needs independently supplied relevance/applicability and response judgments. No person is assumed to provide these. An optional four-group owner visual review could support a clearly labelled Grade 2 exploratory subset, but cannot satisfy the independent protocol or approve a methodological amendment.

All final metrics remain unmeasured. No paid/free model call, full benchmark, new report version or application correction was undertaken by this mission.
