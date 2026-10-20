# NutriScan implementation contract

Standalone TypeScript application. Preserve the ignored owner handoff and its chronology. Never mutate Flowmate or reuse its credentials. Local development only; no public deployment or paid API calls without owner authorization.

Images and profiles stay in the browser unless the user explicitly chooses a disclosed remote action. Keep keys server-side. Do not log request bodies, health context, images or model conversations. Validate all API inputs and external URLs; never render third-party HTML. Bound requests, time and output. Remote features default disabled.

Package OCR is an observation, not verified truth. Missing is not zero. Preserve conflicting values and bases. Never invent nutrient values, references, additive dose, local stock or clinical targets. Every finding must point to observations, calculations or sources. Static evidence cannot establish current law. No universal diabetes carb allowance or safe-portion score.

Use strict shared contracts in src/lib/contracts.ts. Unit tests must exercise actual errors and numerical invariants. Browser screenshots and real network receipts establish integration acceptance; fixtures do not establish genuine photo/provider acceptance.

Parallel implementation is authorized by the owner's mission. Divide modules with one integrator. Core engineer owns src/lib/engine.ts, parser.ts, knowledge.ts and their tests. Integration engineer owns src/lib/server/ and src/app/api/. Integrator owns contracts, app UI, OCR/browser storage, tooling and final QA. Coordinate contract changes. Do not commit another engineer's unfinished changes.

Update docs/STATUS.md, DECISIONS.md and sanitized agent-journal at milestones. Source images and private chat export are never committed. Preserve team attribution: no existing teammate implementation was present at bootstrap.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
