# NutriScan current engineering handoff

Updated 25 October 2026. This is the current handoff; STATUS and AGENT_JOURNAL retain chronology. Use `git rev-parse HEAD` for the exact revision containing it.

## Mission and active milestone

General-purpose package understanding and useful, evidence-aware food conversations across unfamiliar inputs. The latest capability checkpoint combines correction/revision consistency with explicit workspace-portion context and native calculations. Next: broader ingredient/scientific applicability and unfamiliar-package evaluation. Package examples are regressions, never specifications.

## Production architecture

Photos and local OCR/layout observations feed a typed multimodal Gemini reconstruction. The application retains immutable evidence, revisioned interpretations and separate user corrections. Ordinary follow-ups use the compact saved package, explicit workspace portion and bounded conversation context, with native typed tools and plain-text answers. The new client does not parse question amounts or send unsolicited all-nutrient calculations; the model requests derived quantities through tools. React renders trusted operations; code owns arithmetic, evidence identity, persistence and permissions. Legacy atomic-claim/structured-answer adapters are offline compatibility helpers, not the canonical conversation gate. Numeric validation is not proof of scientific entailment.

## Capability maturity

| Capability | Current evidence and limits |
| --- | --- |
| Perception | Real development-photo reconstruction and geometric crops exist. Independent held-out field accuracy and robust coverage across layouts/languages remain incomplete. |
| Canonical state | Original observations, reconstructed revisions, user corrections and conflicts are retained separately. Current work prevents stale calculations/model rows overriding corrections and preserves outdated-answer status across save/reopen. |
| Conversation | Live natural Gemini/tool conversations and photo-free follow-ups work. Explicit workspace state resolved the previously failed mass/volume references in controlled tests; an explicit new question amount also overrode that state. This is not distribution-wide comprehension evidence. |
| Quantitative tools | Deterministic mass, volume, pieces and serving calculations exist, with evidence-linked count conversion and no assumed density. Tool-result-to-widget handoff was fixed at `9962397`. Correction precedence is checked at input, execution, validation and display boundaries. With a current reconstruction, legacy parsed nutrients cannot replace it in calculation or numerical answer authority. |
| Knowledge | 29 semantic summaries, 11 additive identities, 3 Indian terminology groups and 2 ingredient-outcome relations. Added 74 reviewed ingredient-name/source relationships across milk, wheat, soy, egg and peanut, with five official source records and reproducible section-pinned import. Exact reference lookup is not automatic allergen detection. FoodOn, USDA and EFSA snapshots extend access; clinical/outcome relationships remain sparse. |
| Consumer UI | Thread workspace, scanner, correction controls and optional compact inspector exist. Desktop/mobile screenshots verify current correction-state rendering; the latest acceptance uses synthetic state and explicit development provider requests, not new photo accuracy or a complete live consumer scan. |
| Reliability/cost | One primary dev environment and bounded/free-first provider routing. Readable opt-in traces and sanitized diagnostics work. First-scan distribution, comparative modality accuracy and long-session reliability remain open. |

## Current measured evidence

- Ingredient-family milestone: a real free Flash-Lite request on developer-authored ingredient context chose three parallel ingredient lookups and used Health Canada milk/wheat sources alongside existing identity evidence. Two generations / 6,923 SDK tokens (6,372 input, 551 output), 8.08 s route time, local estimate ₹0; thinking/cache counts absent. No photos or real profile were sent. This demonstrates source handoff and answer use, not independent clinical accuracy. Five families / 74 aliases passed source attestation; compound names and generic possible-source terms abstain.
- The same provider output exposed numbered Markdown headings being misread as unsupported quantities. An offline replay after the formatting-boundary fix retains headings while the numerical tests still reject invented amounts. No second generation was spent to rephrase the answer. Transcript: `.data/gemini-evaluations/0be21eda-9498-46fd-b60d-44edd613835f/events.jsonl`; tested single-run export: `.data/gemini-evaluations/exports/ingredient-families-20261025.md`. Full tests: 675 passed / 1 skipped with two workers; TypeScript and two Python importer checks passed. Commercial redistribution of the Canadian extract requires a separate rights review/permission; current use is non-commercial with attribution.

- `correction-continuity-20261025` under ignored `.data/`: browser edit/cancel/save/reload preserves the correction and outdated answer on solid/sodium and liquid/protein fixtures. Screenshots were inspected at 1440×900 and 390×844. No owner browser/session was used.
- Before explicit state, two controls selected the wrong printed serving despite using the correction: 30 instead of 20 g, and 200 instead of 250 ml. With explicit workspace state and native calculations, both requested amounts were recovered. A final varied-wording run retained 20 g -> 180 mg sodium and overrode the earlier 250 ml selection with a new 150 ml request -> 5.1 g protein. Answers and returned calculators agreed; these use developer fixtures, not new real-photo evidence.
- The final two follow-ups used five free Flash-Lite generations / 12,753 SDK tokens, with 4.53 s and 5.88 s route times. One extra round rejected an optional `candidateId:null`; null-as-omitted normalization now passes offline checks, without a post-change call-reduction claim. Thinking/cache counts were absent. All six controlled tasks in this milestone used 13 free generations / 34,185 tokens / local estimate ₹0. No Google billing balance was read.
- Final readable export: `.data/gemini-evaluations/exports/workspace-portion-final-20261025.md`. Full suite: 647 passed / 1 skipped; final tool/route checks: 127 passed / 1 skipped; TypeScript passes. No production build or new photo extraction was performed.
- Preserve old observations/model readings in storage and the inspector, but omit superseded values from active follow-up model context and numeric authority. A user correction is not independent verification.

## Repository and runtime

- Private repository: `https://github.com/Suvichan2005/NutriScan`; owner branch `codex/generalized-package-intelligence-wip`. Normal fast-forward pushes only.
- One registered worktree: the primary checkout. Preserve unrelated generated `next-env.d.ts`, `tsconfig.json`, `.vitest/` and knowledge `__pycache__` state.
- Primary dev: `http://127.0.0.1:3418`, PID 37200 at inspection; reusable output `.data/next-gemini-qc-dev`. Do not build over that live output or restart it without preserving scans. Older existing production processes on 3421/3422/3423 were observed and left untouched; they are not acceptance environments for this milestone.
- Ordinary operational files: `.data/gemini-diagnostics.jsonl` and `.data/gemini-usage.json`. Readable local evaluations: `.data/gemini-evaluations/<analysisId>/`.
- Readable capture: `NUTRISCAN_GEMINI_EVAL_CAPTURE=1`, local `NODE_ENV=development`, no hosted/CI environment. Credentials, image bytes and hidden reasoning are excluded. Real sensitive context is not an authorized test fixture.

## Next prioritized implementation

1. Expand linked ordinary-ingredient, assessment and clinical-guidance coverage by food/health question families; evaluate whether retrieved population/dose/applicability information improves actual answers. Scientific entailment remains a model/evaluation responsibility, not a lexical overlap score.
2. Add unfamiliar, rights-reviewed package cases and independent annotations. Then run the bounded OCR-only / OCR+images / images-only pilot; keep development and held-out products separate.
3. Broaden conversational acceptance to changing goals, references across longer histories, comparisons and uncertainty. Include current-state overrides and tool-result use across models; the small portion pilot does not establish general reliability.

## Settled constraints

Free Gemini is preferred. Controlled paid development fallback is authorized within spending controls; consumer free mode is not unrestricted paid consent. Keep photos/profile local until the disclosed authorized action. Do not expose secrets, publish private assets, invite collaborators, force-push or deploy publicly. Preserve the natural-agent architecture and standard interactive components. Do not resume product-specific prompt, keyword or answer-template patches.
