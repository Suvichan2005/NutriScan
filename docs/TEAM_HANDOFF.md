# NutriScan team handoff

Use the published `checkpoint/2026-10-22-team-handoff` branch as the collaboration base while the owner preserves the existing `main` history. Create feature branches from that checkpoint and target PRs to it for owner review; do not push directly to shared branches or merge PRs. The checkpoint removes the two restricted historical JPG paths without rewriting remote `main`. Do not add package photographs, personal profiles, API keys, cached models, private OCR receipts, or restricted source files. Contributors may read the repository, but the paths below define their edit scope.

## Yug — OCR and package extraction

Own OCR implementation files under `src/modules/ocr/**`, except the annotation/evaluation files assigned to Yash below. The stable entry is `src/modules/ocr/index.ts`; shared Zod types remain in `src/lib/contracts.ts`. The reader accepts browser `ImageAsset` inputs and returns ordered OCR text, word boxes, recognition metadata and capture provenance. `parseLabel` returns the shared package contract with unresolved and conflicting readings retained. It does not establish package truth.

Start with the existing module fixture runner: `node src/modules/ocr/test.mjs`. The first useful task is broad recovery of missing, clearly printed English nutrient value/unit/basis rows across owner-approved Indian development labels. Keep candidate values separate from observed/confirmed package fields and report correct, wrong, omitted and withheld counts. Private development photographs and held-out products remain owner-controlled.

## Subham — food knowledge and retrieval

Own `src/modules/knowledge/**`. `index.ts` holds the normalized, attributed `evidenceSources` corpus, additive identifiers and local lexical search. `server.ts` provides local MiniLM plus BM25 retrieval; it reads the pinned local model under `.data/models/` and the generated `data/semantic-index.json`. Add new source summaries with direct URLs, publisher, jurisdiction, dates, limitations and a license-review note. Do not copy restricted source text or infer product contents from a knowledge match.

Run `node src/modules/knowledge/test.mjs` without API credentials or model downloads. `npm run embeddings:evaluate` and `npm run embeddings:evaluate:boundary` use developer-authored queries; they are not independent relevance results. `npm run embeddings:prepare` regenerates the index and may download the pinned public model if it is not already available locally. Do not exchange `.data` caches; request the owner to regenerate root-level index artifacts during integration.

## Yash — annotation and independent evaluation

Own `src/modules/ocr/annotation.ts`, `evaluation.ts`, `fixtures/**`, annotation/evaluation tests in `src/modules/ocr/__tests__/**`, and new provider-independent comparison runners in `src/modules/ocr/evaluation-tools/**`. The runner `node src/modules/ocr/test.mjs` exercises module contracts; new TypeScript runners can use `npx tsx <path>` without changing root scripts. Compare OCR-only, text-assisted, selective-vision and combined methods using injected fixtures until live providers are separately authorized. Evaluation inputs use the shared extraction contract and independently recorded per-field references; keep development tuning groups separate from locked product-group evaluation. Do not add package photos, held-out annotations, provider credentials, or live-provider receipts to Git.

If Yug is unavailable, the owner may temporarily assign Yash OCR implementation files after suspending overlapping Yug ownership. Root scripts, cross-engine browser runners, shared contracts, application code and provider authorization remain owner-controlled; Yash can propose changes in the PR description without editing those files.

## PR and integration handoff

Every PR should stay in the assigned paths, state the user-facing or measurement change, include its module-local command and result, identify fixture versus real-photo evidence, list unresolved limits, and explain any required owner-side contract, script, route or UI work. Do not modify held-out labels after candidate selection. No teammate branches or invitations have been created by this handoff; the owner will assign people and paths at the meeting.
