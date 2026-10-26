# NutriScan current state

**As of:** 27 October 2026
**Active checkout:** `C:\Users\KIIT0001\Documents\Seventh Semester Project NutriScan\NutriScan-study-ops`
**Branch / HEAD:** `codex/m2-subject-scope-20261027` / `39938caf276b050af495219f6b4e7d96f8eea9cc` (prompt/test checkpoint; includes integration through `c7eb429`).
**Other checkout:** the original `NutriScan` worktree remains separate and untouched by this work. Two registered worktrees are present.
**Working tree:** tracked files clean; a pre-existing untracked `scripts/evaluation/__pycache__/` remains. No dev server is running.

## Product and architecture

NutriScan is a Next.js 16 / React / TypeScript India-first package understanding and food-intelligence application. The browser retains scans and profile context unless the user consents to remote analysis. The application maintains OCR/image evidence, model interpretations, revisions, corrections, calculations and retrieved sources separately. Gemini is the model-led assistant with native typed tools; the application owns persistence, calculations, source identity, permission checks and rendering. The consumer surface is a chat-first workspace with a compact evidence inspector. See `docs/DECISIONS.md`, `docs/DATASET_COVERAGE.md` and `docs/COMPLETION_QUEUE.md` for contracts and source maturity.

## Verified capabilities

- Package text/photo flows, saved package context, follow-up calculations, evidence inspection, corrections and source-aware UI exist in the current branch; implementation coverage varies by feature.
- Local conversation preservation now avoids replacing explanatory/regulatory answers with missing-value boilerplate and retains topic-matched sources linked by selected findings, subject to existing scope filters.
- Merged identity/lookup safeguards prevent ambiguous parser text from becoming the package title or default product query.
- Latest focused browser acceptance used synthetic trans-fat label text at 390×844 and 1440×900. It displayed WHO and dated FSSAI source cards, retained uncertainty, withheld a numeric calculation and abstained on current-law status. It made no provider/external calls; receipt: `docs/evidence/trans-fat-browser.json`.
- Historical local development receipts under `.data/m2-source-acceptance-20261027/` show a broad sugar/carbohydrate-claim answer accepted numeric facts from a Gemini package reconstruction while making no source-tool call. The answer's withheld-number notice did not distinguish those accepted but unverified reconstructed quantities. The shared natural-answer validator now keeps those readings usable while adding a concise package-details confirmation notice; user-corrected values are excluded from that notice. Focused tests, Gemini-agent/diagnostics tests and TypeScript pass. No new provider request was made.
- Latest full offline suite: 849 passed, 2 skipped. TypeScript and optimized production build passed on this revision.

These checks establish local behavior and integration/build health only. They do not establish photo reconstruction accuracy, live Gemini tool use, scientific entailment, current legal status or independent human-reviewed answer quality.

## Active work and blockers

**M2 source-grounded conversational intelligence remains ACTIVE.** Verify across distinct development scenarios that Gemini appropriately selects eligible source tools, uses their returned records, presents relevant citations in the actual UI and maintains relevant context on follow-up. Separate model tool-selection failures from missing data, retrieval applicability, execution failures, and UI/citation losses. Do not force retrieval solely from health keywords or tune to one food/example.

This checkout has no `.env.local`; the bounded live development receipts below were produced in an isolated child process with free-only routing and synthetic inputs. The current prompt change improves concise follow-up behavior but does not resolve selective source-tool use or establish broad model adherence. Do not claim model adherence from fixtures or this single scenario.

M3 image/package reconstruction accuracy, knowledge completeness, unfamiliar-package transfer, human-reviewed evaluation, and final academic results remain incomplete. Historical pilot and source status are recorded in the queue, dataset coverage file and engineering journal.

## Next executable milestone

Run one bounded, non-held-out live development case after eligible credentials are configured: verify the whole path from package/context through selective source-tool call, returned evidence, final answer/source UI and a relevant follow-up. Record model/tier, attempts, tokens, latency and estimated cost; preserve failures. Then validate an unrelated scenario without changing the frozen study configuration.

## Bounded synthetic provider evidence (27 October 2026)

The free-only sodium scenario timed out on Flash 3.8, received provider-unavailable 503 on 3.7, and succeeded on 3.6. Four successful response generations made three tool calls (package reconstruction, nutrition guidance, knowledge search); two WHO records were returned, and two unsupported quantitative spans were withheld. Successful calls reported 19,956 tokens (18,312 prompt, 613 candidate, 1,031 thinking). The local `who-sodium` source is the WHO “Sodium reduction” fact sheet dated 2026-05-11. This was synthetic package input with no photos/profile, and no consumer browser rendering or Google billing read.

A canonical 50 g follow-up with saved context changed from an overlong repeated overview (4,545 tokens) to a direct portion answer (4,465 tokens) after a generic agent instruction. Both used one generation, no photos, and no tools. This one matched pair does not establish general answer quality or efficiency. The instruction and regression assertion are committed at `39938caf276b050af495219f6b4e7d96f8eea9cc`; suite/typecheck/build pass.
