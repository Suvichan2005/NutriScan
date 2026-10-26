# Protected staging readiness — inspected 26 October 2026

Assessment baseline: integration `0bfe794cff39a88e168e64a8390b0c88db7dd50c`. Status: BLOCKED for invited remote reviewers. No public deployment, tunnel, provider request, npm install or production build was run by this workstream. This is a source/runtime-dependency assessment, not a security certification or deployment acceptance.

## Recommendation and hosting comparison

Prefer one conventional Node.js instance behind authenticated TLS reverse proxy for the first bounded reviewer study. A container is suitable after the integration owner reviews data inclusion, origin handling and runtime storage. Node >=22.13 is declared; pin a specific tested Node version with node:sqlite support and the repository lockfile. This architecture can mount selected read-only knowledge stores and a separate durable ledger without packaging the full private `.data` corpus.

Next officially supports Node server and Docker self-hosting: https://nextjs.org/docs/app/guides/self-hosting (consulted26 October2026). A managed protected preview offers convenient branch/build URLs and access protection, but ephemeral filesystem/runtime/native-dependency and source-store inclusion must be validated. Vercel documents a4.5MB request/response limit: https://vercel.com/docs/functions/limitations (consulted26 October2026). Current assist route caps JSON input at4,300,000 bytes, below that quoted platform limit; this alone is not an incompatibility. Base64 overhead and two-image real payloads still need measurement; larger packets must fail clearly or be prepared locally without secret uploads. Do not infer arbitrary upload support from a successful build.

## Actual code boundaries

| Evidence | Finding / implication |
|---|---|
| src/lib/server/http.ts localGate | Requires loopback request hostname and Host plus same Origin. A real remote preview currently fails403. It also uses process-local rate/concurrency counters; replicas would not share them. |
| src/app/api/assist/route.ts | Node runtime, maxDuration120, bounded4,300,000-byte JSON, Server-Timing header. Platform/proxy timeout must allow the application’s bounded work. |
| src/lib/server/gemini.ts | Natural agent deadline110s and per-call timeout; reconstruction has separate generation work. Measure whole request latency rather than assume110s covers every initial stage. |
| src/lib/server/gemini-provider.ts | Free/paid modes and caps; reservations/ledgers require reliable storage and serialized budget accounting. Restarting replicas or losing local disk must not reset cost policy. |
| src/modules/knowledge/server.ts, foodon-records.ts; food-composition*.ts; guideline-documents.ts | Filesystem/SQLite/model readers. Git clone alone does not include ignored stores. Edge runtime unsuitable unchanged. Source images/evaluation answers are not required runtime data. |
| next.config.ts | Native/server-only packages include ONNX runtime, canvas, pdfjs, Tesseract and transformers. Check native binaries and cold-start memory on the exact target OS/architecture. No standalone bundle guarantee. |
| package.json; scripts/prepare-ocr.mjs; public/ocr | postinstall prepares OCR assets; browser Tesseract/Paddle workers/models must be actually served with correct paths/MIME/cache policy. No browser path means no local OCR acceptance. |
| src/lib/server/gemini-evaluation-recorder.ts; .env.example | Readable local evaluation capture is opt-in. Disable capture and synthetic-profile logging on staging; sanitized operational telemetry alone. Never mount the owner’s full transcript directory. |

## Required integration-owner proposal (no shared modules changed here)

1. Preserve current local-only gate. Add a separately configured staging gate with exact allowed Origin/Host, authenticated reviewer sessions, CSRF protection, trusted-proxy configuration and no forwarded-host trust from arbitrary clients. Authentication must protect pages AND expensive API routes/status/research routes. Do not simply delete localGate.
2. Add enforceable per-reviewer and shared project request/concurrency/budget controls. Free key only; no paid credential mounted, ENABLE_PAID_GEMINI=false and ENABLE_PAID_GEMINI_FALLBACK=false. Refuse startup if staging accidentally allows paid routing. Server-side secret injection only.
3. Define a read-only runtime asset allowlist. FoodOn/core USDA/selected WHO/model files may be mounted after rights review; exclude EFSA derived redistribution, all study/reference inputs, original images, annotations, private reports, local traces and `.env.local`. Do not COPY .data or the entire owner checkout into an image.
4. Keep budget/operational ledger durable in a separate write location. Confirm recorder/store path overrides or prepare a reviewed volume layout; do not assume serverless writes persist. Multi-instance budget correctness is an explicit blocker.
5. Retain explicit cloud-photo consent and profile-sharing choice. No proxy/WAF/APM/body logging, private responses in analytics, screenshots of real health context, or third-party evidence HTML. Include source-license acknowledgments.

## Resources and reproducible release

Start with a measured single instance and a small invited concurrency limit. No RAM/CPU or monthly-cost claim is verified. Measure baseline RSS, model-loaded RSS, peak first request, cold/warm latency, database disk and request sizes on the intended host; choose resources from those measurements. Quota errors remain unavailable/retry, not paid escalation.

Bind reviewer response exports to exact Git commit, lockfile hash, Node version, build ID, enabled tool/source manifests/hashes, model/config, mode, question/context/response hashes and per-call usage/timing. Build one immutable release; do not update it during paired study collection. Freeze sources and conversations separately from routing availability; record fallback/noncomparability explicitly.

## Invited-reviewer acceptance checklist

- Unauthenticated page and every API fail closed; approved reviewer session works; revoked reviewer fails.
- Remote Host/Origin combinations, cross-site posts, oversized payloads, concurrency and quota exhaustion behave correctly.
- Fresh browser, scan two authorized photos, all five method choices, permission disclosure, answer, saved-context follow-up, correction and session reopening work on desktop/mobile.
- Browser worker/model requests succeed, source tools find selected mounted stores, missing stores are explicit, external research preserves attribution/applicability.
- No photos/profile/request bodies/answers in proxy/APM logs; no keys/answer keys/private traces in bundle or network static assets.
- No paid route/key available; quota failure preserves scans. Record actual model and usage separately from Google billing.
- Human review uses frozen response packets and independent ratings. Usability feedback and scientific ratings are distinct.

## Local simulation and deactivation

Current source has a loopback gate and no reviewer authentication. A production-like remote reviewer simulation would need the integration-owner changes above; claiming acceptance now would be misleading. After those changes, install dependencies once in the chosen integration environment, use one designated production build output, bind the app only to127.0.0.1 behind a local authenticated proxy, and run the checklist with Gemini disabled before any bounded authorized provider test. No extra build directory or server was created here.

Rollback: retain previous immutable release and source manifest; pause invitations, disable ENABLE_GEMINI and upstream key access, stop the preview/proxy, revoke reviewer access, preserve sanitized receipts under agreed retention, and remove temporary sessions after owner review. Do not remove original source/research data or alter Google Drive permissions.

## Local production simulation completed26 October

A fresh pinned dependency installation (`npm ci --no-audit --no-fund`) completed once in the isolated study worktree. The inspected postinstall copies local Tesseract/English/Paddle runtime assets from npm packages; it does not invoke a provider. A single Next16.4.2 webpack production build completed under Nodev24.4.1 in `.data/study-staging-build`. No original checkout dependencies/builds were recreated.

The loopback-only instance on127.0.0.1:3422 passed14 HTTP/configuration checks: home/status200, Gemini disabled, readable capture disabled, Tesseract worker/English model/Paddle WASM200, foreign Host and cross-site Origin403, malformed JSON400, oversized input413, and probed private paths404. **The private paths were not populated with real secrets or source stores, so these probes are not proof of full sensitive-data isolation.** Browser OCR execution, rendering, worker initialization, native source retrieval, authentication, proxy deployment and provider behavior are not established by asset200 responses.

The owned test process stopped; next-env.d.ts/tsconfig.json exactly restored to pre-build hashes. No credentials copied/mounted, provider call or external listener. Existing original protected owner files remain unchanged. Sanitized receipt: `evidence/local-production-smoke-20261026.json`; private build/server logs: `.data/study-staging/`. Knowledge stores were intentionally not mounted, so read-only runtime asset and authentication/quota blockers remain.

To reproduce after dependency setup in a dedicated credential-free checkout:

```powershell
python tools/semester-study-ops/local_staging_smoke.py --port 3422
```

This always builds the current checkout into the same designated dist directory before starting its own bounded loopback process. It strips provider credentials from its child environment and disables Gemini/paid/capture flags. It does not deploy, enable access, touch original private data or start a public endpoint. A local smoke is one gate; remote reviewer readiness remains BLOCKED on the integration-owner proposals above.
