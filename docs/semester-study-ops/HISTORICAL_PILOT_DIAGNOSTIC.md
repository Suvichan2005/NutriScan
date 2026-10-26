# Historical conversation pilot diagnostic — 27 October 2026

Scope: read-only inspection of original ThinkBook development receipts; no provider requests, model/configuration edits or experiment rerun. Sanitized findings only, no response bodies, profiles, keys or hidden reasoning. Original input paths below are relative to the original NutriScan checkout, not this study worktree.

## Model selection

The archived `.data/semester-conversation-pilot-20261026/run.mts:3` explicitly assigns both `GEMINI_MODEL` and `GEMINI_FREE_MODEL_ORDER` to `gemini-3.5-flash-lite` before importing the server module. It also selects free mode and disables paid fallback. `freeze.json:4` binds that model, with implementation602ec4d0553ebbb9e0f9cbaafd5e43744ba49c03. This was a pinned-model development run, not an exercise of the production four-model preference order.

For26 completed turns, the33 recorded provider routes each have exactly one attempt: Flash-Lite, `used`; none has a skipped/failed higher-model attempt. All33 provider response `modelVersion` fields equal `gemini-3.5-flash-lite`. The failed A-D third turn is additionally identifiable as diagnostic649484ef-4e25-4d36-ae64-c0544ca82f52; its response also reports Flash-Lite, but the application did not produce a completed answer (`A-D-3-failure.json`: provider_incomplete). Thus34 provider responses are visible across the27-turn attempt;33 belong to completed answers.

Exact example: `.data/gemini-evaluations/78a00cf0-ed53-4076-9bc8-a0a87c4e0701/events.jsonl:4` reports SDK modelVersion; line5 records the one-attempt route. The failed-turn transcript has the same fields at lines4–5 and ends failed at line8.

Earlier same-day sanitized diagnostics do show temporary availability failures: `.data/gemini-diagnostics.jsonl:4316` (3.8 at04:44:32Z),4318 (3.7 at04:44:36Z),4323 (3.6 at04:58:02Z), all classified provider-unavailable / UNAVAILABLE. A route at04:44:55Z successfully selected3.6 after3.8/3.7 failed. Those are service-availability observations, not evidence of invalid model names, missing permissions or daily-quota exhaustion. Their recorded cooldowns all expired before this pilot began at05:35:46Z; the surviving routing-cooldown file contains only3.6, expiring05:03:02Z. It is a mutable later snapshot, not a complete historical state archive. The explicit one-model pin alone establishes why higher models were not attempted in the pilot. No surviving note proves the operator's original rationale for that pin.

Historical `generateTracked` compares actual model/tier against the request context and mutates that context after a successful selection. Therefore `fallback:false` means no change from that call's requested model/tier; it does not assert that all globally preferred models were available or tried. Skipped candidates are recorded in `attempts`, and a later round may report false after an earlier fallback changed the context. All pilot attempts contain only Lite, so false is internally correct here. It must not be reported as successful four-model preference routing.

Unknown: whether3.8/3.7/3.6 would have succeeded at the pilot time, why the earlier service was unavailable, project permissions/quota then, or actual Google billing. No request tested those alternatives during the pilot. SDK `serviceTier:standard` is not proof of paid billing; route/configuration metadata and billing must remain distinct.

## Source utilization

All26 initial requests contain `evidence:[]`. Every request exposed the same11 ordinary tools, including ingredient resolution, local knowledge, nutrition guidance, WHO document/page retrieval, product and USDA lookup. Availability in the declaration is not execution or successful runtime access.

All10 actual calls were `calculate_nutrition`:7 successful results and3 errors. All10 tool-result evidence arrays are empty; the7 successes returned calculation records. None called a source lookup. All26 final `agentEvidence` arrays are empty. This is an agent source-selection/use gap, not evidence that retrieved records were dropped only during final attribution.

Example `.data/gemini-evaluations/10280f7f-d222-4a61-b3c2-6d77f04d1733/events.jsonl`: line3 records declared tools and initial package context; lines7–8 request two calculators; lines9–10 return successful calculations with no source records; line11 returns tool results to the model in the next request. The model also received saved reconstructed package content, linked package observations, fictional profile/context and previous turns. Zero retrieved sources therefore does not mean zero model-visible package/calculation evidence. It does mean this run demonstrates no external scientific-source retrieval or application.

Completed-turn receipts account for235161 input and4351 reported output tokens. The failed turn adds6321 reported input tokens; its output-token count is absent, not a measured zero. Do not omit failed-call usage from a whole-task denominator. This audit made no new calls.

## Current M2 and final-study recommendations

Reviewed integration52faf25724e4204d75dc5aca87a1434953b9790a. Its supplied-source checks address topic/jurisdiction filtering and contextual follow-up continuity, with provider-free transfer coverage for relevant diabetes sources, unrelated peanut questions and short portion follow-ups.117 focused source/assist tests pass on the combined revision. These are mocked/deterministic checks; they do not establish that a real model spontaneously retrieves useful sources. M2's own journal explicitly leaves entailment and fresh model adherence unverified.

Before final experiments: freeze one selected eligible model and effective configuration across arms; retain SDK modelVersion and every generation's model plus all route attempts, not just the final alias/fallback boolean. Treat changed/fallback models as noncomparable or a separately declared stratum. Use existing adapters/runner; complete their agreed build/prompt/source/input binding rather than create a second experiment definition. Keep knowledge-off truly tool-restricted, verify knowledge-on retrieval and final source use separately, and preserve missing retrieval as an outcome. Do not force a condition-specific lookup merely because of a keyword. The historical run is development evidence only, not a knowledge ablation or independently rated scientific result.
