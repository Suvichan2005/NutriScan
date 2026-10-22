# NutriScan implementation contract

Standalone TypeScript application. Preserve the ignored owner handoff and its chronology. Never mutate Flowmate or reuse its credentials. Local development only; no public deployment or paid API calls without owner authorization.

Images and profiles stay in the browser unless the user explicitly chooses a disclosed remote action. Keep keys server-side. Do not log request bodies, health context, images or model conversations. Validate all API inputs and external URLs; never render third-party HTML. Bound requests, time and output. Remote features default disabled.

Package OCR is an observation, not verified truth. Missing is not zero. Preserve conflicting values and bases. Never invent nutrient values, references, additive dose, local stock or clinical targets. Every finding must point to observations, calculations or sources. Static evidence cannot establish current law. No universal diabetes carb allowance or safe-portion score.

Use strict shared contracts in src/lib/contracts.ts. Unit tests must exercise actual errors and numerical invariants. Browser screenshots and real network receipts establish integration acceptance; fixtures do not establish genuine photo/provider acceptance.

Parallel implementation is authorized when the owner assigns it. Yug owns OCR image reading and extraction implementation under `src/modules/ocr/**`, excluding the separately assigned annotation/evaluation files below. Subham owns `src/modules/knowledge/**`. Yash owns OCR annotation and provider-independent evaluation work in `src/modules/ocr/annotation.ts`, `evaluation.ts`, `fixtures/**`, evaluation tests under `src/modules/ocr/__tests__/**`, and new comparative runners under `src/modules/ocr/evaluation-tools/**`. Yash may compare injected OCR and inference candidates offline without credentials; root scripts, real-image collection, cross-engine browser runners, shared contracts and provider calls remain owner-controlled. If Yug is unavailable, the owner may temporarily assign Yash OCR implementation files; suspend overlapping Yug ownership first. The inference module has no teammate owner until separately assigned. Codex remains integrator for shared contracts, application UI/state, browser storage, routes, API/provider orchestration, tooling and final QA. Contributors may read the repository but may edit only their assigned paths; all other paths are owner-controlled. Coordinate interface changes with the owner and do not commit another contributor's unfinished changes. Contributors work on their own feature branches and open PRs; only the owner merges to main.

Update docs/STATUS.md, DECISIONS.md and sanitized agent-journal at milestones. Source images and private chat export are never committed. Preserve team attribution: no existing teammate implementation was present at bootstrap.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
