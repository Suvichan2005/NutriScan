# Evaluation integration requests

These requests belong to evaluation preparation. They do not authorize edits to production tools, prompts or shared contracts during Track A integration.

## EVAL-IR-001 — Controlled initial extraction versus later recovery

**State:** pending integration checkpoint; final comparison blocked.

The native production agent can request image inspection, ingredient/nutrition recovery and research. A controlled OCR-only / image-only / OCR+image comparison must keep model, instructions, generation settings, question and source access comparable, while ensuring that the initial extraction cannot obtain evidence from another modality. A successful consumer API call alone does not establish that control.

At a freeze checkpoint, the integrator must review the evaluation adapter's submitted request and tool availability against the actual reconstruction boundary. Record the original OCR/image hashes, exact initial attachments, prompt/tool/configuration hashes, actual model/version, route and every subsequent recovery operation. An arm that changes model or obtains a disallowed modality is noncomparable for initial extraction. Later autonomous recovery is a separate stage with its own quality, latency and cost receipt. No production prompt or routing change is made by this preparation task.

## EVAL-IR-002 — Canonical package to existing extraction receipt

**State:** adapter verification pending; shared scoring implementation retained.

The existing provider-independent scorer accepts `OcrExtraction` and scores complete value/unit/basis fields against annotated originals. The new evaluation bridge invokes that scorer directly. Before final testing, validate the candidate adapter from the saved canonical reconstruction into this existing contract across readable, provisional, withheld, conflicting, corrected and missing fields.

A returned model row is not automatically accepted. The adapter must record whether the application actually makes the reading usable without a manual correction, preserve uncertainty, and identify original photo/region lineage. Record provisional readings separately even when useful to the user. Do not create a second nutrient scorer or reinterpret a model-produced quantity as a reference. User-corrected and original automatic outputs require separate receipts.

## EVAL-IR-003 — Retrieval freeze and source applicability

**State:** BLOCKED ON A for final cross-source evaluation; human judgment preparation may proceed.

Track A is still validating acquisition, preservation, access, tool integration and answer utility. At the appropriate checkpoint, freeze the selected corpus/structured-store identities, eligible record set, index hashes, relevance pool and tool policy. Have independent reviewers label source relevance and population/jurisdiction/exposure applicability separately. Developer-authored relevance fixtures remain development evidence.

Final retrieval and answer comparisons must identify exactly which Track A capabilities were ready. A changed source snapshot, tool implementation or index creates a different experiment configuration. Do not silently substitute an incomplete source release or report an endpoint response as answer-quality acceptance.
