# NutriScan integrations

All services are for local development. The application binds to `127.0.0.1:3400`. No provider key was installed, enabled or used during implementation. There is no deployment.

## Explicit remote actions

Local OCR, package editing, numerical analysis and browser storage do not use these routes. Clicking a disclosed public search sends its query to the named public service. Gemini routes require a separate consented action; images and profile context must not be sent automatically.

| Route | Strict request | Result |
| --- | --- | --- |
| `GET /api/status` | No body | `gemini.configured`, `enabled`, `model`, `searchEnabled`, explanation; no key or credential material |
| `POST /api/products` | `{query?:string,barcode?:string,alternatives?:boolean,country?:string}`; alternatives require an explicitly selected country | `{status,products:ProductRecord[],message,requestId}` |
| `POST /api/research` | `{query:string,topic:'science'|'regulation'|'claims'|'brand'|'alternatives'|'recalls'}` | `{status,items:ResearchItem[],message,requestId}` |
| `POST /api/assist` | `{consent:true,question,package,profile?,evidence?,images?}` | `{status,answer,claims,limitations,inspectImage,requestId}` |
| `POST /api/vision` | `{consent:true,image:{mimeType,base64,side},instruction?}` | `{status,observations,limitations,requestId}` |

Errors return `{status,code,message,requestId}` with a relevant HTTP status. `disabled` is separate from `unavailable`. An empty search is separate from a source failure. The UI must display these states honestly.

`images` in assist contains browser metadata only: `{handle,side,width,height}`. An optional `inspectImage:{handle,reason,crop?}` selects a known browser image. The crop uses normalized `x,y,width,height` within `[0,1]`. The browser owns that handle, previews/crops the original, and performs an explicit disclosed vision request. Unknown handles and out-of-bounds crops are rejected. No browser image is fetched by a server URL.

## Public services

Exact barcode lookups use the canonical Open Food Facts v2 product endpoint. Candidate name search uses the official Search-a-licious POST search service. The v2 product server does not support full-text search. Candidate requests return at most four matches and enrich each with at most one canonical product fetch. Country-filtered alternatives require a country explicitly entered by the user and a matching upstream country tag. A country tag does not establish present availability. All results state `local stock unverified`.

Nutrients retain upstream explicit `100g` or `100ml` metadata. When that metadata is absent the basis is `null`; package quantity is never used to invent the basis. Sodium is converted from upstream grams to milligrams. Zero survives; missing, negative and non-finite values do not become zero. Crowdsourced records require comparison against the photographed regional package. Last-modified and retrieval timestamps are separate.

Science search uses Europe PMC core records. It returns publication dates, publication type, abstract text when provided, canonical links, and DOI where valid. Results are discovery candidates. Relevance, human applicability, dose, study quality, retraction status, conflicts and consensus are not established. A protocol or review is not mislabeled as a completed randomized trial. The application does not infer causality from search matches.

Regulation/claim discovery uses a fixed registry of primary FSSAI and WHO pages. A retrieved page excerpt is plain text, never rendered HTML. FSSAI discovery cannot establish consolidated current law, an effective date, authorization or package compliance. No arbitrary external URL fetch is offered.

`brand` and `recalls` search the fixed public openFDA food-enforcement endpoint without an API key. At most four records, sorted by report date, are returned as **historical United States candidate matches**. Each retains exact recall number, firm, product description, lot/code, distribution, report and initiation dates when provided, source link and dataset-update caveat. This is not a universal brand-credibility score, an Indian recall check, a live alert or a recall-lifecycle service. FDA warns that recorded status may not be updated after classification. Empty results do not establish safety or absence of recalls; failures are reported separately. No consumer reviews are scraped or invented.

## Gemini activation and boundaries

The official `@google/genai` SDK uses `models.generateContent` with `responseMimeType:'application/json'` and `responseJsonSchema`, followed by independent Zod validation. It does not combine built-in search with custom function declarations. Built-in search remains disabled even if the search environment flag is set, and status reports this honestly.

Activation requires **all three** server environment settings: an owner-supplied `GEMINI_API_KEY`, explicit `GEMINI_MODEL`, and `ENABLE_GEMINI=true`. Configuration is not provider acceptance. Each sensitive request additionally requires `consent:true`. Calls can incur provider usage charges; no automatic retry or continuation is enabled. A client timeout cannot guarantee cancellation of provider computation or billing. No model call was made for acceptance in this run.

Assist claims cite existing package-observation IDs and supplied evidence IDs. Unknown and empty citations fail validation; unknown image handles fail validation. The model's free-form `answer` is ignored: the returned answer is reconstructed only from validated structured claim texts with their existing observation/source identifiers attached. Without claims, a fixed uncertainty/request-for-evidence message is returned. Identifier membership checks do **not** prove source authenticity, entailment or answer completeness. Claim interpretations still need review against their evidence. System instructions prohibit invented nutrients/doses, clinical targets, current-law conclusions and a universal safe-portion score, but prompt instructions are not a proof of model compliance.

Vision accepts JPEG, PNG and WebP, canonical base64, maximum 2 MB encoded source bytes and 24 megapixels. MIME signatures and actual decoding are both checked. The server strips metadata and produces a bounded JPEG before transmission. Vision emits observations with `origin:'vision'`; it never promotes a model transcription to verified truth. Confidence is model-reported and uncalibrated. A genuine photo/provider journey remains unaccepted until the owner authorizes a configured provider and tests an actual package photo.

## Request bounds and privacy

Every POST requires local hostname, exact same-origin browser Origin and JSON content type. Host must be a loopback authority on the existing local request port. The validated Host handles Next's localhost normalization when the actual browser visits 127.0.0.1; forwarded hosts are ignored. Cross-site requests are rejected before work. Product/research routes allow 8/10 requests per minute respectively; assist and vision share 4 requests per minute. Each group permits at most two active requests. These in-memory limits are appropriate to the single local development process, not a distributed production limiter.

Public fetches have fixed HTTPS destination hosts, no credentials, no ports, redirect rejection, a 12-second deadline, content-type checks and byte caps. Request JSON is streamed with byte limits. Gemini uses a 25-second client deadline, no automatic retries/continuation, 4,000 output tokens, a 160 KB provider-response ceiling and a 50 KB structured-text ceiling. Neither request bodies nor images, profile context, conversations, keys or raw provider failures are logged by these modules.

## Observed live source receipts — 21 October 2026 IST

These are genuine direct calls through implemented server functions, **not yet browser/HTTP-route acceptance**. Queries below are public non-personal acceptance probes. No source image or private profile was sent.

| UTC receipt | Probe | Direct observation |
| --- | --- | --- |
| `2026-10-20T22:06:00.263Z` | Exact barcode `3017620422003` | `ok`; OFF returned Nutella; explicit `100g` basis; modified `2026-10-20T09:09:52Z`; France/Germany tags. This is not an Indian formulation claim. |
| `2026-10-20T22:06:02.861Z` | Europe PMC `aspartame randomized trial` | `ok`; 6 candidate publications, including `MED/42356152`, `MED/41713874`; returned publication types/abstracts. Search also returned results where aspartame was a placebo; relevance still needs assessment. |
| `2026-10-20T22:07:43.829Z` | WHO `sugar sweeteners weight` | `ok`; both fixed WHO guideline pages returned usable live text. |
| `2026-10-20T22:09:13.740Z` | Alternatives `oats`, India | `ok`; 4 candidates enriched through canonical OFF records: `8901088068758`, `8902710100150`, `8901088213974`, `8906058611194`. All returned explicit `100g` metadata and retained unverified local stock. |
| `2026-10-20T22:07:43.270Z` | FSSAI labelling/claims | `unavailable`; official pages returned HTTP 200 but only a 3,221-byte JavaScript app shell. Shell text was rejected as evidence. Interactive official-page review is required; current law remains unverified. |

The older CGI search returned HTTP 503 during investigation. Search-a-licious initially returned zero for a quoted/parenthesized whole-query expression because its generated wildcard-field query did not match. Sanitized unquoted terms with the explicit India filter returned real candidates; the implementation uses that observed working form. This correction is distinct from a fabricated empty-result success.

## Observed local HTTP-route receipts

The following were real HTTP calls to `http://127.0.0.1:3400` with explicit matching Origin headers. They establish route-to-public-service integration, **not browser screenshots or genuine photo/provider acceptance**. Time window: `2026-10-20T22:13:12Z` to `22:13:25Z` (21 October IST).

| Route probe | HTTP / result | Receipt request ID |
| --- | --- | --- |
| Status | 200; configured=false, enabled=false, searchEnabled=false | Status does not generate a request ID |
| Exact barcode `3017620422003` | 200 / ok / 1 result, explicit 100g | `fa99d7f4-0ddd-4255-aff3-5a56ef5369a1` |
| India oats alternatives | 200 / ok / 4 canonically enriched 100g candidates | `330bdc78-699b-457e-b07a-93ae2c76b90c` |
| Science `aspartame randomized trial` | 200 / ok / 6 Europe PMC discovery results | `9aed7d8e-33e6-4b33-8200-367fbb661a85` |
| WHO `sugar sweeteners weight` | 200 / ok / 2 usable primary pages | `417b66f2-48e4-48de-a016-2a0ed67e3a71` |
| US FDA recall candidates `Nestle` | 200 / ok / 4 historical reports: F-0535-2025, F-0261-2025, F-1491-2023, F-0732-2023 | `183e47dc-1823-4de4-830c-962c0be72025` |
| FSSAI labelling | 200 / unavailable / zero usable evidence pages; no current-law verdict | `fa78b268-cce3-4f58-a0c3-7ff3111b1173` |
| Consented synthetic empty assist input, provider disabled | 503 / disabled / provider_disabled; no provider call | `ec11cda2-c85c-471f-97ec-7b4660958cc8` |
| Cross-origin product request | 403 / origin_rejected, before source work | Failure receipt inspected directly |

Focused failure/numerical suite: `npx vitest run src/lib/server/server.test.ts` — **18 passed** after Host normalization, US recall scope, shell rejection and answer-reconstruction additions. Full `npx tsc --noEmit` also passed at this milestone. These boundary checks do not prove genuine provider or photo acceptance.
