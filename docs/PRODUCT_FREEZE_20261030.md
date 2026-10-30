# Final product-completion checkpoint

Baseline: `75936b9142f2ad803b2ab58a4622a79877e0c038`. This pass is limited to demonstrated product defects, local persistence and one production-browser journey. It does not resume research, local-model testing or report writing.

## Correctness decision

Reviewed the six retained Flash-Lite RAG outcomes from the research-closure checkpoint (fixed evidence and retrieval for sodium attribution, sugar claims and milk-related risk), including questions, package states, tool traces, supplied evidence, validation counters and displayed answers. The private `correctness-triage.json` retains their exact displayed wording and original receipt references. These are development observations, not independent nutrition judgments.

The existing numerical validator already checks nutrient identity, amount/unit dimensions, qualifiers, supported bases, typed portion conversions and correction precedence. Relevant unchanged calculation/basis and association regressions were exercised. A source's identity or numerical agreement does not establish that the source entails a conclusion. In particular:

* A combined-product panel does not establish how sodium is divided between noodles and seasoning. A model can give an unsupported qualitative component attribution even after its unsupported numbers are withheld.
* Patient nutrition education does not establish regulatory definitions of sugar-free and no-added-sugar. Dietary carbohydrate reasoning and claim compliance are separate questions.
* A milk-derived ingredient clue does not make allergy and intolerance equivalent, or establish an individual's reaction risk or absence of cross-contact.

No new prompt rule, forced lookup, product-specific filter or heuristic conversational answer was added. The retained errors remain limitations. Relaxing numeric validation globally would allow incorrect associations; adding lexical filters would not convincingly resolve semantic applicability. No improvement in these scientific failure classes is claimed.

The live serving-comparison acceptance did expose a separate, reproducible integration defect: two calculator calls returned 13 nutrients each, but only the first 20 operations reached answer validation. Results near the end of the second portion were discarded before the validator could check them. The displayed comparison omitted protein and sodium. A synthetic wide-panel provider-path reproduction retained the first portion but incorrectly removed the valid second-portion sentence before the fix. The correction retains all results from the already bounded tool rounds internally, validates against them, and applies the unchanged 20-result public/saved limit afterward, prioritizing accepted answer operations. Existing nutrient, unit, basis, qualifier and correction checks remain intact. This repairs evidence transport rather than weakening validation or manufacturing answer text. Exact before/after reproduction and the subsequent real-provider outcome are retained privately; no broader scientific improvement is inferred.

## Changes

Investigations now save automatically through the existing IndexedDB history key. Completed conversation turns, package revisions, user corrections and portion state persist; the latest saved investigation reopens automatically. Pending or unavailable answers do not become generated chat prose. Existing histories remain compatible. The existing bounds remain 20 recent investigations and 30 completed turns per investigation.

Recent scans provides individual deletion and a separate confirmation step for clearing all history. Active requests must finish before destructive controls become available. History writes are serialized; IndexedDB updates remain transactional. Deletion/clear cannot be undone by an earlier queued autosave in the same session. An active investigation is reset when deleted, preventing it from immediately saving itself again.

Saved conversations previously allowed only three cited records even though the live answer context supports eight. Four or more live citations could therefore make a saved record fail validation. The persisted limit now matches eight; unsafe links and excessive records remain rejected. Reopening also preserves the bounded quantity/source/provisional caution counts, rather than silently discarding the live answer's notes. Full provider traces and private profile fields are not added to saved history.

Photos remain session-only. Saved text can itself contain personal information, so the interface discloses browser-profile access and provides deletion. There is no cloud sync or encryption claim. Browser storage can be cleared or evicted; this is continuity, not a backup guarantee. Editing the same investigation concurrently in multiple tabs is not a conflict-resolution workflow.

## Verification and demo limitations

See `docs/evidence/product-freeze-20261030.json` for the completed verification receipt. Private artifacts are retained under `.data/product-freeze-20261030-v1/`; original research receipts are unchanged.

For Monday, demonstrate reconstruction, inspection, a checked correction and deterministic portion calculation, with source inspection where available. Keep the saved investigation as a continuity aid. Do not present one browser journey, software-test counts, source cards or this development photograph as independent extraction accuracy, clinical correctness or complete scientific entailment. Free-provider availability is an external dependency; failure must remain an explicit retry state, never a substituted local chat answer.

Use the same `codex/stable` checkout and normal commands in `docs/LOCAL_DEVELOPMENT.md`. Preserve the original release tag, historical research commits, private assets and owner overlays. Stop development at this checkpoint.
