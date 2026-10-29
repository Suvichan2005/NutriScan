# Matched conversational development evaluation

This evaluation extends the preparation checkpoint `7c9ac26`, without changing application behavior, photographs, annotations or report artifacts. Inputs are Grade 3 model-assisted package records. Agreement with these records is not independently verified nutritional accuracy or clinical validation.

## Conditions and parity

The private `matched-conversation-benchmark-20261029-v1/run-v3` freeze contains 27 original turns and 24 transfer turns. Each model receives the same logical system instruction and serialized user payload within a condition. Package reconstructions are immutable saved records; no image reconstruction or cached final answer is used.

Synthesis supplies identical precomputed production calculator results and local guidance passages, with no callable tools. Native orchestration supplies the same twelve logical production tools, with up to three generation rounds. Knowledge-off retains calculation and clarification, with the nine original first-turn contexts unchanged. Source APIs requiring external network access are unavailable equally; this is a local-resource tool condition, not unrestricted internet research.

For exact context parity, original turns use frozen historical assistant context. Transfer turns retain previous user questions with an explicit unavailable-assistant-answer marker. This measures continuation from shared context, **not** each model's own closed-loop conversation. Unknown-sodium fixtures for A-H and B-H also mask historical assistant prose that could reveal the withheld value, as required by the existing semester input protocol.

`check_matched_requests.mts` verifies all request/package hashes and checks actual first-request serialization in retained receipts. It does not judge answer quality. An earlier request freeze and all earlier measurements remain retained separately; reuse requires identical logical request hashes.

## Provider differences

- Ollama receives the same logical declarations in its function interface with lowercase JSON Schema types; Gemini uses the production declarations in its SDK interface. The model-specific Ollama chat template is an unavoidable serialization difference and must be retained with model metadata.
- Temperature is zero, seed is fixed and output ceiling is 768 tokens. Ollama uses a 16,384-token context, six CPU threads and no GPU. Local thinking is disabled; Gemini 3.8 uses low thinking and Flash-Lite uses minimal. These settings are disclosed differences, not equal reasoning budgets.
- Google uses the existing tracked production provider. Non-streaming responses cannot establish TTFT. Local streamed responses record first visible text, prompt/generation durations and model allocation. Missing token/billing fields remain unknown.
- No automatic adapter retry occurs. The production provider's existing single short quota retry can still occur; network events and ledger reservations must be examined. A provider failure stops its batch rather than silently switching model/tier.
- Flash-Lite is explicitly free and 3.8 explicitly paid. Owner approval permits at most $2 additional estimated/reserved paid exposure, subject to the existing $11.10 cumulative guard. The child cap is the stricter starting committed spend plus $2. Provider billing is not independently observed.

## Outputs and interpretation

Each receipt preserves raw response, complete generation/tool outputs, evidence identities, numerical/source validation, text display blocks, configuration hashes, failures and network destinations. `conversation-evaluation-views.mts` calls the production source and numerical validators and text layout helpers. It does not establish browser DOM acceptance or reproduce every UI component. Any later offline rendering reconciliation must be versioned separately, preserving the original receipt.

Windows samples record available memory, committed memory/limit, paging, pagefile usage, CPU and per-process working/private memory. Whole-machine network totals include unrelated applications; only instrumented application fetch destinations are attributable to this runner. This is not a packet-capture proof of zero machine-wide egress.

Results must distinguish answer completion, numerical association correctness, tool argument correctness, source identity and actual entailment. Source-card counts and passed input checks are not scientific grounding scores. Human ratings remain unfilled. Qualitative developer assessments must be labelled, with exact excerpts and limitations. Time/cost per correct answer is only meaningful for an explicitly scored subset and must not use completion as a proxy.

## Commands

Run from the study checkout with the repository's Node runtime:

```powershell
node --import tsx tools/semester-study-ops/check_matched_requests.mts
node --import tsx tools/semester-study-ops/matched_conversation.mts run gemini-3.5-flash-lite synthesis --phase=primary --repeat=0
node --import tsx tools/semester-study-ops/matched_conversation.mts run gemini-3.8-flash native --phase=primary --repeat=0
node --import tsx tools/semester-study-ops/matched_conversation.mts run phi4-mini native --phase=primary --repeat=0
```

Preparation writes exclusively and must never overwrite an existing freeze. Run destinations are also exclusive. Resume into a distinct phase name with explicit remaining case IDs; preserve failures and account for all planned cases. Run models sequentially, never concurrently. No production build, OCR study, report rewrite or provider tier substitution is part of this task.

### Execution qualifications retained with receipts

The comparative adapter has a declared three-generation native budget; unlike the production agent, it does not add a separate forced-final generation. Round-limit failures therefore describe this bounded condition, not proof that the full production agent would fail. Automatic production evidence injection and calculator presentation extras are not added asymmetrically; synthesis uses the explicit common frozen evidence, while native measures the common declared tools. Browser evidence covers a private replay through actual production React answer/tool components, not an entire production application journey.

An adapter correction preserves returned canonical identity search terms across tool rounds, matching production. The 26 earlier native receipts were inspected: none returned such terms, so none depended on the corrected state. Earlier telemetry defaulted profileIncluded to false even though canonical requests included authorized fictional profiles; request bytes establish that inclusion, and subsequent telemetry reports it explicitly. Neither issue changes the frozen initial requests. These are adapter integrity disclosures, not production changes.

Two free-route 429 failures are retained. A subsequent continuation may use an explicit inter-turn delay (up to 20 seconds), outside the measured turn interval, to reduce batch pressure. This delay is recorded in execution configuration; it does not establish the provider's exact unknown quota metric. Do not silently replace failed primary outcomes with later repeats or switch to paid Flash-Lite. Batch throughput including pacing and per-turn request latency are different quantities.

Latency begins at the logical conversational turn after adapter module initialization; it includes model loading when observed, provider generations, tools and validation, but excludes artificial inter-turn pacing. This is not full browser bootstrap, image reconstruction or uncached photo-to-answer timing. Reconstruction is deliberately not rerun in this conversation study. Local cold/warm allocation and provider-reported cache tokens are retained; neither absent cache metadata nor a missing thinking field is interpreted as zero. The provider's modelVersion is recorded as reported, even when it does not identify a dated immutable weight revision.
