# Final Flash-Lite product checkpoint — 30 October 2026

## Reconciliation and boundary

One branch, `codex/final-flash-lite-20261030`, contains the accepted orchestration audit, inference-only chat correction, reviewed benchmark infrastructure, and this focused correction. The original integration release is an ancestor and unchanged. Protected original checkout overlays and this worktree's next-env/globals overlays remain private and unstaged; byte hashes checked. Pending retrieval precision/capture work is now committed and its 13 Python tests passed. CPU benchmarks remain stopped. No report writing occurred.

Baseline: d4a3af4; production code/build: c562228270e818137bd85b1fc66d0ce8537dd8d1. Six canonical application requests were frozen before calls; request hashes match across phases. We exercised actual /api/assist routes, then two untouched transfer turns in an optimized production browser session. Direct route cases are not falsely described as six manual UI journeys. All cases used controlled, synthetic declaration records with corrections/provenance; the earlier real-photograph receipts are retained, not counted as new photo-accuracy evidence.

## One correction cycle

1. Citation protocol typography is normalized before existing source/numeric validation. `SRC 1` and `SRC_1` can identify the same returned handle. Missing handles remain explicit and rejected; neither identities nor clinical prose are invented.
2. Nutrition guidance now requires topical/condition support independently of publisher identity. Publisher words do not supply their own topical match. This prevents unrelated Who/history and publisher-address queries from obtaining dietary records. Positive sodium guidance remains available. No forced retrieval or question-specific answer rule was added.
3. The existing WHO sodium record now includes its official salt equivalent. Verified against https://www.who.int/news-room/fact-sheets/detail/sodium-reduction on 30 October 2026 (adult recommendations and converter sections). Its population/whole-diet limitations remain. The 29-record semantic index was rebuilt offline from installed weights to keep source/index hashes consistent; no corpus expansion or model download.

The natural prompt/tool declarations, inference-only architecture, correction arithmetic and UI are retained. No heuristic conversation fallback was introduced.

## Actual results and judgment

| Case | Before/after finding |
|---|---|
| Corrected 30g portion | Both produced 3.6g protein and18g carbohydrate from the corrected/current rows. Pass for this controlled association. |
| Hypertension/sodium | Both computed150mg correctly and retrieved relevant WHO evidence. Correct reference/comparison sentences were still removed in paired outputs. Partial, not a completed grounding fix. |
| Indian sugar claims | Neither selected retrieval; no returned source records. Broad distinction present, quantitative rule withheld. Source-use acceptance fails in both; current legal applicability not established. |
| Milk/peanut uncertainty | Both recognized declared milk and did not infer peanut absence. Baseline's free-from exception was overstrong; later omission is model variation, not a demonstrated fix. No source call. |
| Out-of-domain history | No dietary citation cards. Model admits nutrition library cannot support history. Stranded introductory wording remains a presentation weakness. |
| Unknown net weight | Both preserve missing net contents and decline to invent half-package values. |

The untouched production UI case returned a 3-rice-cake/30g calculator with2.4g protein,15g carbohydrate and180mg sodium. After an8->10g/100g protein correction, half the80g package gave4g protein,20g carbohydrate and240mg sodium. Original readings and outdated-answer markers remain. The follow-up used the saved reconstruction without pixels or another reconstruction. Its expanded answer retained WHO's2000mg/day and5g salt/day reference with an expandable correctly linked source. This was automatically supplied guidance plus a calculator call, not autonomous research. Some correct table/derived percentage prose was still withheld, although calculator values were visible.

The improvement is source-identity handling and a reproducible irrelevant-publisher retrieval boundary. It does not establish improved overall answer accuracy. Remaining lexical relevance vetoes can still miss paraphrases, optional tool selection is unreliable for claim questions, and numerical validation can discard useful whole-sentence comparisons. No extra tuning loop was run to conceal these failures. The two production browser turns extend acceptance but are not a matched causal comparison.

Single-run paired route latency (ms), before/after: portion3641/6422; sodium6578/4109; claim2641/2921; allergen2187/7063; negative2844/2281; missing4172/12765. These are observed route times, not TTFT, a benchmark distribution or evidence of a speed gain.

## Verification and reproducibility

Six before plus six after application responses and two real production browser turns: all actual inference used explicit free gemini-3.5-flash-lite; no paid fallback/calls. Exact provider request bodies (instructions, facts, histories, function results), raw responses, final application responses, tool/source traces, displayed browser text and screenshots are retained privately. Thought content and credentials are excluded. One403 preflight caused by missing Origin was retained separately; it never reached Gemini and is not a model failure.

Full final test run:952 passed/2 skipped,83 files, maxWorkers2. Earlier run caught the temporarily stale index and three regulation-test timeouts; after offline reindex the bounded-worker run passed without changing those tests. TypeScript and a clean optimized build passed through page generation and tracing. Build from exported tracked source leaves owner overlays untouched; nested-directory tracing-root warning recorded. Actual next start on loopback served browser acceptance; this is not public deployment acceptance.

Private package: .data/final-lite-acceptance-20261030/ (cases, comparison.json/results.csv, actual provider traces and browser evidence). Sanitized receipt: docs/evidence/final-flash-lite-20261030.json. Private snapshots preserve owner bytes and original interrupted receipts. Only owner overlays remain dirty; clean tracked code is published on this branch. Stop here: no CPU resumes, additional models, benchmarks or report work.
