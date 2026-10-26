# Receipt comparability and integration requests

`receipt_ops.py` reads existing prepared-job and adapter receipt shapes. It delegates all token/cost aggregation to `scripts/evaluation/run_experiments.py:usage` and leaves nutrient scoring entirely to `scripts/evaluation/score-reconstruction.mts`.

```powershell
python tools/semester-study-ops/receipt_ops.py --prepared .data/study/prepared.json --receipts .data/study/receipts.json
```

It reports missing jobs, changed model/config/modality, fallback, recovery/answer contamination, unbound build/freeze/input hashes, per-arm product-group denominators and the intersection of comparable groups. It does not manufacture accuracy scores. Provider usage uses the SDK field names emitted by reconstruct-initial.mts; cost uses `estimatedTotalUsd` from the existing provider recorder. Billed USD remains unknown. OCR wall time and total task wall time remain separate fields; never substitute summed provider time.

## Proposed adapter receipt extension — integration owner review required

The current adapter already returns actualModel, actualGenerationConfig, fallbackOccurred, actualInputSelection, actualStage, recoveryCalls and answerGenerationCalls. The wrapper additionally requires `studyBinding` with implementationCommit, freezeId, promptHash, sourceSnapshotHash, toolAccessHash and inputHashes (exact relative path→SHA256 mapping). Current production adapters do not yet emit this binding, so their current receipts will be explicitly BLOCKED here until the owner implements an agreed binding or a custodian signs a verified sidecar. This is an integration request, not a new experimental definition or a change to the existing final gate.

Do not fill the binding by copying expected values without validating the actual running build/config/input bytes. The existing runner verifies current checkout/files before execution but the returned adapter receipt alone does not expose the complete bindable record. This wrapper deliberately identifies the gap rather than claiming that a historical response was produced by a new revision.

## Final study conditions

- Use existing final gates before execution; this audit cannot activate provider runs.
- Preserve every failed/unavailable receipt. Never silently exclude it from a method denominator.
- For unequal comparable subsets, publish both method-specific coverage and the paired product-group intersection. Different photos of one product are not independent products.
- Feed comparable scored receipts into the existing report generator with verified source anchors. Empty final inputs produce PENDING status, not fabricated numbers.
- Human nine-dimension ratings remain distinct from the legacy six-field answer scorer. No automatic many-to-one mapping is introduced.
