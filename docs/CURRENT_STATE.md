# NutriScan current engineering handoff

Updated 25 October 2026. This is the current handoff; STATUS and AGENT_JOURNAL retain chronology. Use `git rev-parse HEAD` for the exact revision containing it.

## Mission and active milestone

General-purpose package understanding and useful, evidence-aware food conversations across unfamiliar inputs. The active capability is consistent corrections, package revisions and conversational context. Package examples are regressions, never specifications.

## Production architecture

Photos and local OCR/layout observations feed a typed multimodal Gemini reconstruction. The application retains immutable evidence, revisioned interpretations and separate user corrections. Ordinary follow-ups use the compact saved package and bounded conversation context, with native typed tools and plain-text answers. React renders trusted operations; code owns arithmetic, evidence identity, persistence and permissions. Legacy atomic-claim/structured-answer adapters are offline compatibility helpers, not the canonical conversation gate. Numeric validation is not proof of scientific entailment.

## Capability maturity

| Capability | Current evidence and limits |
| --- | --- |
| Perception | Real development-photo reconstruction and geometric crops exist. Independent held-out field accuracy and robust coverage across layouts/languages remain incomplete. |
| Canonical state | Original observations, reconstructed revisions, user corrections and conflicts are retained separately. Current work prevents stale calculations/model rows overriding corrections and preserves outdated-answer status across save/reopen. |
| Conversation | Live natural Gemini/tool conversations and photo-free follow-ups work. Free Flash-Lite has ignored the prior requested amount in two controlled mass/volume cases, using the printed serving instead; input preservation alone is insufficient. |
| Quantitative tools | Deterministic mass, volume, pieces and serving calculations exist, with evidence-linked count conversion and no assumed density. Tool-result-to-widget handoff was fixed at `9962397`. Correction precedence is checked at input, execution, validation and display boundaries. |
| Knowledge | 29 semantic summaries, 11 additive identities, 3 Indian terminology groups and 2 ingredient-outcome relations in current source. FoodOn, USDA and local EFSA snapshots plus live read-only source tools extend identity/reference access; these are not comprehensive ingredient/clinical reasoning coverage. Source applicability and agent use remain partially evaluated. |
| Consumer UI | Thread workspace, scanner, correction controls and optional compact inspector exist. Desktop/mobile screenshots verify current correction-state rendering; the latest acceptance uses synthetic state and explicit development provider requests, not new photo accuracy or a complete live consumer scan. |
| Reliability/cost | One primary dev environment and bounded/free-first provider routing. Readable opt-in traces and sanitized diagnostics work. First-scan distribution, comparative modality accuracy and long-session reliability remain open. |

## Current measured evidence

- `correction-continuity-20261025` under ignored `.data/`: browser edit/cancel/save/reload preserves the correction and outdated answer on solid/sodium and liquid/protein fixtures. Screenshots were inspected at 1440×900 and 390×844. No owner browser/session was used.
- Explicit free-provider controls used the current correction, but resolved “same amount” to 30 g instead of prior 20 g, and 200 ml instead of prior 250 ml. Arithmetic was correct for the wrong selected amount. These are failed context-selection results, not accepted end-to-end answers.
- Two controls used four free Flash-Lite generations / 10,928 SDK tokens total. Thinking/cache counts were absent. Local estimated charge ₹0; no Google billing balance was read. The first response was later replayed for rendering without another provider call.
- Preserve old observations/model readings in storage and the inspector, but omit superseded values from active follow-up model context and numeric authority. A user correction is not independent verification.

## Repository and runtime

- Private repository: `https://github.com/Suvichan2005/NutriScan`; owner branch `codex/generalized-package-intelligence-wip`. Normal fast-forward pushes only.
- One registered worktree: the primary checkout. Preserve unrelated generated `next-env.d.ts`, `tsconfig.json`, `.vitest/` and knowledge `__pycache__` state.
- Primary dev: `http://127.0.0.1:3418`, PID 37200 at inspection; reusable output `.data/next-gemini-qc-dev`. Do not build over that live output or restart it without preserving scans. Older existing production processes on 3421/3422/3423 were observed and left untouched; they are not acceptance environments for this milestone.
- Ordinary operational files: `.data/gemini-diagnostics.jsonl` and `.data/gemini-usage.json`. Readable local evaluations: `.data/gemini-evaluations/<analysisId>/`.
- Readable capture: `NUTRISCAN_GEMINI_EVAL_CAPTURE=1`, local `NODE_ENV=development`, no hosted/CI environment. Credentials, image bytes and hidden reasoning are excluded. Real sensitive context is not an authorized test fixture.

## Next prioritized implementation

1. Carry explicit workspace portion state into the agent and remove competing default-amount assumptions from conversational orchestration. Evaluate current-question override, prior-amount references, mass/volume separation and tool-result/UI use together, without lexical intent gates.
2. Expand linked ordinary-ingredient, assessment and clinical-guidance coverage by food/health question families; evaluate whether retrieved population/dose/applicability information improves actual answers.
3. Add unfamiliar, rights-reviewed package cases and independent annotations. Then run the bounded OCR-only / OCR+images / images-only pilot; keep development and held-out products separate.

## Settled constraints

Free Gemini is preferred. Controlled paid development fallback is authorized within spending controls; consumer free mode is not unrestricted paid consent. Keep photos/profile local until the disclosed authorized action. Do not expose secrets, publish private assets, invite collaborators, force-push or deploy publicly. Preserve the natural-agent architecture and standard interactive components. Do not resume product-specific prompt, keyword or answer-template patches.
