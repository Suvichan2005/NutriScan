# Evaluation execution and freeze controls

This is evaluation-only tooling. It does not change production prompts, schemas, retrieval, routing or model configuration, and performs no implicit network/provider requests. Definitions are in `data/evaluation/experiment-plan.json`; the varied interaction portfolio is `data/evaluation/conversation-scenarios.json`. These are developer-authored methods/scenarios, not independent reference answers or measured results.

Concrete production-bound adapter acceptance is still pending [integration requests](EVALUATION_INTEGRATION_REQUESTS.md): controlled initial modality/recovery (IR001), canonical package-to-existing extraction mapping with accepted/provisional/withheld status (IR002), and source/applicability freeze (IR003). A generic injected adapter establishes harness execution only. It does not establish that these Gemini comparisons are ready or measured.

## Prepare and freeze

The collection register remains the source for acquired product/photo metadata. Project it to a private experiment case manifest, keeping every family/GTIN variant in one product group and one split:

```json
{"splitLock":"proposed","cases":[{"caseId":"unique-case","productGroupId":"family-or-gtin","split":"development","developmentExposed":true,"rightsReviewed":false,"referenceStatus":"unannotated","referenceFile":null,"referenceSha256":null,"inputFiles":[{"path":".data/evaluation-preparation/photos/example.jpg","sha256":"actual-file-sha256"}]}]}
```

Map the collector's `familyGroupId` to `productGroupId` when several GTINs share a family; map `proposedSplit` to `split`, except a proposed `held-out` allocation must become `prospective-held-out` while `splitLock` is not `locked`. Map `exposureStatus` to the explicit boolean, and acquired images' `privateLocalFile`/`sha256` to `inputFiles`. Do not convert `metadata-only-not-model-exposed` into a claim of independent ground truth. Rights-review pending means `rightsReviewed:false`. Keep the historical exposed groups in development permanently. Unacquired slots are not acquired products.

Config requires `family` (one of the six definition IDs). For a final freeze it also needs exact `implementationCommit`, `model`, nonempty `generationConfig`, `promptHash`, `sourceSnapshotHash`, `toolAccessHash`, `freezeId`, `trackAReady:true` and `frozenFiles:[{role,path,sha256}]`. Roles `prompt`, `tools`, `sources` bind those hashes to actual checked files; include every material implementation, dataset, OCR preprocessing, retrieval configuration and reference artifact as additional frozen files. A source snapshot can be a manifest of the pinned actual source/index hashes. Do not hash secrets or include credentials. The final gate checks current commit, every frozen artifact, input bytes, independent reference bytes, rights and locked splits. Required Track A capabilities remain **BLOCKED ON A** until actually ready; a manually written flag is a recorded reviewer declaration, not evidence by itself.

The `trackAReady` dependency is enforced for retrieval/answer studies. Performance instead requires `measurementMethodsFrozen:true`, and its input files can be usage/timeline receipts; it does not require nutrition annotations. Retrieval reference cases require `referenceKind:"graded-query-relevance-and-applicability"`; query/reference JSON files are their acquired inputs, without a photograph requirement. Other final accuracy/answer studies require acquired input files, rights review and reference files. Every independent reference case declares `referenceReview:{readers:["reader-a","reader-b"],adjudicated:true}` with two distinct codes; the hashed reference artifact preserves the actual source passes/decisions. Final manifest also requires `splitReview:{reviewerCode,artifactFile,artifactSha256}`. Prospective held-out allocations cannot pass final gates.

Every final arm needs `armAdapters[arm]:{argv:[...],inputSelection:{modalities:[...]}}` and a `frozenFiles` entry with role `adapter:<arm>`. The adapter's argv and input selection are frozen and checked at execution; `ocr-only` requires `["ocr"]`, `image-only` requires `["image"]`, combined arms require `["ocr","image"]`. Captures for secondary-reader arms must additionally record the actual reader set. Frozen input selection is a required execution contract; concrete application adapter acceptance remains IR001/IR002, not automatically satisfied by writing config.

```powershell
python scripts/evaluation/run_experiments.py prepare --manifest .data/evaluation-preparation/cases.json --config .data/evaluation-preparation/config.json --output .data/evaluation-preparation/jobs-development.json
python scripts/evaluation/run_experiments.py freeze --manifest .data/evaluation-preparation/cases.json --config .data/evaluation-preparation/config.json --output .data/evaluation-preparation/jobs-final.json
```

Output is write-once and explicitly `READY` or `BLOCKED`. A blocked freeze is a useful preparation artifact, never a final result. Validate applicability independently: the same query can retrieve the right identity but wrong jurisdiction, population, dose or endpoint. Independent human references and graded relevance pools are required; LLM annotations and developer visual checks cannot unlock that gate.

## Controlled execution

An adapter is an explicit JSON argv array, for example `["python",".data/evaluation-preparation/local-fixture-adapter.py"]`. It reads one job from stdin and emits one JSON receipt on stdout. There is no shell interpolation. `execute` requires an explicit action flag because an adapter may make authorized provider calls; `prepare`, `freeze`, `score` and tests do not call a provider.

```powershell
python scripts/evaluation/run_experiments.py execute --prepared .data/evaluation-preparation/jobs-development.json --adapter-argv .data/evaluation-preparation/adapter-argv.json --output .data/evaluation-preparation/run-001 --allow-adapter
```

Adapters must use existing production/evaluation entry points rather than copy or change their prompts. For modality jobs they must retain the original image/ordered OCR hashes and prove which modalities were actually supplied. Keep initial extraction separate from later image/OCR recovery. The existing local pilot `.data/gemini-modality-pilot/run-pilot.mts` demonstrates capture/request handling but is development-only, uses familiar cases and is not the final comparative runner. Secondary OCR compares the same images/model/question with only that reader's observations changed. Retrieval arms must consume the same frozen corpus/query judgment pool; production source work is not modified by this harness.

Each receipt should identify `actualModel`, `actualGenerationConfig`, `fallbackOccurred`, actual modality/input hashes, call/stage IDs, provider usage, tool results/latency, final reconstruction/answer references and failures. Adapter stdout must be a JSON object; null, arrays and scalar values are retained as invalid failed receipts. Final receipts require typed `actualModel`, `actualGenerationConfig`, `fallbackOccurred` and `actualInputSelection`; empty/missing metadata is noncomparable, as are actual model/configuration/input-selection changes or fallback. Every final job rechecks frozen files before executing. Adapter stdout is retained privately; stderr/environment are not copied to shareable reports. The runner bounds a job to 180 seconds and retains failures; adjust by versioning this method if measured latency requires a different predeclared bound. A completed adapter job is not automatically an accepted scientific result.

## Score existing receipts

Nutrition scoring **reuses** `ocrAnnotatedDatasetSchema`, `ocrExtractionSchema`, `assertOcrDatasetSemantics` and `scoreOcrExtraction`. Engine adapters produce the existing `OcrExtraction` contract, including input hashes, provenance, accepted candidates, abstentions, stage evidence and measurements. No competing nutrient scorer is introduced:

```powershell
npm exec -- tsx scripts/evaluation/score-reconstruction.mts .data/evaluation-preparation/reference.json .data/evaluation-preparation/extraction.json study-id
python scripts/evaluation/run_experiments.py score --receipts .data/evaluation-preparation/receipts.json --output .data/evaluation-preparation/scored.json
python scripts/evaluation/test_run_experiments.py
```

The JSON scoring input has optional arrays:

- `retrieval`: `{queryId,arm,k,judgments:{sourceId:0..3},rankedIds,judgmentStatus:"independent-human",poolComplete:true,applicability:{sourceId:"applicable"}}`. Duplicate IDs and invalid grades fail. Unjudged returned records make metrics unavailable rather than irrelevant; negative queries get separate false-match counts. Recall, reciprocal rank and nDCG report their own query denominators, grouped by arm. Applicability is separate (`applicable` / `not-applicable` / `unknown`); absent labels are unavailable and inapplicable returns are counted separately. The pool is the declared reviewed pool, not the whole scientific universe.
- `answers`: `{caseId,raterCode,provenance:"independent-human",scores:{usefulness,grounding,applicability,numericalCorrectness,uncertainty,actionability}}`, each 0–4. Missing/model-generated ratings stay pending. Preserve multiple raters and adjudication independently; no automated prose scoring. A score of 0 means severe failure, 2 partly useful with important limits, 4 correct/useful for the stated question; rater instructions must record concrete unsupported claims and applicability errors alongside the rating.
- `quantitative`: `{caseId,expected,actual,expectedUnit,actualUnit,expectedBasis,actualBasis,absoluteTolerance:0,invariants:{correctionWins:true},referenceStatus}`. Predictions come from existing calculator/state tools. Exact decimal comparison is the default; tolerance must be predeclared. Missing quantities, wrong units/bases and false/unavailable state invariants remain failures. Reference provenance counts separately.
- `usage`: one row per actual call with task/stage identifiers and nullable `promptTokens`, `outputTokens`, `thoughtTokens`, `cachedPromptTokens`, `providerMs`, `toolMs`, `estimatedUsd`, `billedUsd`, and `status`. Each metric reports known sum, reported/missing call counts and complete total only when complete. Cached tokens are part of input counts. Provider work sums are not wall time; end-to-end intervals and concurrent tools require their own task timeline. Preserve retries/failed requests, cold/warm state and model/tier.

All aggregate outputs say `finalResult:false`: they are reproducible scoring artifacts for subsequent independent review, not an automatic publication decision. Product groups are the independence unit; never count correlated columns/crops/repeated scans as new products. Ingredient lists, allergens, identities, additives, claims and warnings need separate human reviewed denominators and original text/regions; the nutrition scorer does not establish those outcomes. Final paper/report tables wait for verified source artifacts, complete references and adjudicated quality judgments.
