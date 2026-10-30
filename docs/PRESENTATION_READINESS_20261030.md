# Final presentation-readiness pass

Scope: the stabilized application, a retained real nutrition-panel photograph, desktop at 1440×1000 and mobile emulation at 390×844. No benchmark, report rewrite, new model, retrieval/prompt change or public deployment. Private evidence: `.data/presentation-readiness-20261030-v1/`.

## Reproduced issues and changes

1. Short structured answers were folded merely because a heading appeared, hiding the requested quantities behind an explanation control. Short answers now remain visible; long answers retain one expandable explanation. No model prose is summarized or replaced.
2. Vision-only reconstruction showed “0 observations” even with usable nutrition rows. The inspector now distinguishes structured label fields from raw observations and uses correct singular source/observation labels. This is an evidence count, not a verified-reading score.
3. Expandable application notices repeated lengthy explanations. Copy is shorter but still states unconfirmed readings and excluded numerical/source statements. Model uncertainty remains untouched.
4. The reported malformed emphasis `Limitations:*` is handled as a formatting edge case, while footnotes, comparisons and multiplication are preserved. It was not reproduced in the four fresh model answers; a focused formatting test covers it. No health-word or product-specific replacement was added.
5. The portion card displayed “1 servings,” repeated units in nutrient names and inconsistent capitalization in its picker. Those display labels are normalized; printed labels, calculations, evidence IDs and selected nutrient identities are unchanged.
6. The context button extended beyond a 390-pixel viewport. It now wraps within the mobile header. Final readback found its right edge inside the viewport and no horizontal document overflow.

## Observed journey

| Step | Actual result | Evidence |
|---|---|---|
| Optional context | Skippable onboarding; no private profile entered or shared. Mobile skip button remains visible. | `01-desktop-onboarding.png`, `07-production-mobile-start.jpg` |
| Add package photo | Retained Saffola nutrition-panel original selected through the file chooser. Photo rotate/undo worked. | `02-photo-review.jpg`, `08-production-mobile-photo.jpg` |
| Reconstruct | Real free Flash-Lite Vision request, current production tools and schema; actual serving 38 g and selected per-100 g rows retained. No product name invented from a nutrition-only crop. | `production-response-1.json`, network/provider receipts |
| Review/correct | Protein was visibly 8.8 g/100 g. Saved that same photo-checked transcription through the correction contract rather than inventing a different value. Original interpretation remained visible. This is operator confirmation, not independent human ground truth or a demonstrated before/after arithmetic change. | `09-production-original-evidence.jpg`, `10-production-mobile-inspector.jpg`, `12-production-desktop-inspector.jpg` |
| Follow-up | Real saved-package request used the confirmation, with photo handles only and no image bytes/reconstruction call. Half serving = 19 g; displayed protein 1.67 g, carbohydrate 13.15 g, sodium 433.77 mg. WHO adult context and an inspectable source card were retained. | `production-response-2.json`, `production-network.json`, `14-production-desktop-followup.jpg` |
| Calculator/source | Local 0.5 servings → 19 g conversion, return conversion and one-serving singular text checked. Another nutrient could be selected without inference. Original source-photo dialog works for Vision-only evidence. | `13-production-desktop-calculations.jpg`, `17-final-mobile-calculator.jpg`, `18-final-desktop-calculator.jpg` |
| Save/restore | Two real conversation turns and correction restored from opt-in history on the final build. Original images are deliberately not saved; restored screenshots are labelled accordingly. Inspector Escape returned focus to its trigger. | `15-final-mobile-followup.jpg`, `16-final-mobile-source.jpg`, final DOM/readbacks |

Four application requests ran in total: two initial audit requests and two optimized-production requests. Ten provider responses all reported `gemini-3.5-flash-lite` on the explicit free route, zero paid calls/fallback. WHO was available as automatic guidance context; the follow-up's actual model calls were calculations. This does not establish fresh model-selected scientific retrieval or broad scientific acceptance.

The final rebuild added only the last header/picker display fixes. It reused the opt-in saved real responses for final layout acceptance instead of spending quota on identical answers. Live tool traces were verified before reload; historical saved chat does not restore the complete transient tool-activity trace or every validation diagnostic. The private network/provider receipts preserve those details. No synthetic package or intercepted model response was used in this pass.

## Verification and limits

* 955 tests passed, two skipped; focused display tests passed. TypeScript validation passed. Final optimized build passed compilation, TypeScript, page generation, optimization and tracing. No compile-only build claim.
* Real in-app Browser inspection covered the selected desktop/mobile journey. Final console readback had no warnings/errors. Keyboard inspector dismissal and focus return were checked. This is not a complete WCAG audit, real-phone hardware test, camera test or every optional research control.
* Reconstruction omitted some printed rows in the fresh production result; this pass makes no complete-label accuracy claim. Existing quantitative withholding and source-selection limits remain. A source card is not proof of clinical applicability. No validated inference/retrieval behavior was changed to improve appearance.
* Development hot refresh reloaded an unsaved investigation during source editing. Production acceptance then used opt-in save/restore. Do not edit code during an unsaved demonstration.
* The selected journey has no reproduced presentation-blocking control/layout failure after these fixes. Provider availability and known scientific/validation limits remain relevant to a live demonstration. Keep a saved investigation and screenshots as a backup, with no claim that saved text is fresh inference.

## Repository and startup

`codex/stable` is the everyday branch in the existing `NutriScan-study-ops` checkout. The private `.env.local` was restored there so plain `npm run dev` works; local free Lite is selected and paid routes disabled. Ordinary metadata capture was disabled after acceptance. No keys were printed or committed.

The integration remote is fast-forwarded to the accepted stable line, GitHub's default branch becomes `codex/stable`, and superseded PRs #4/#5 are closed because both tips are already ancestors. `main`, the original release tag and protected original worktree remain unchanged. One old subject-scope branch has 42 unique commits and is not a deletion candidate. Optional checked deletion commands are private artifacts, not executed cleanup. See [the daily run guide](LOCAL_DEVELOPMENT.md).
