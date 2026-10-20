# Threat model and current limits

## Protected assets

- Provider API keys and owner authorizations.
- Original package photos and EXIF metadata.
- User-supplied allergy, health, dietary and location details.
- Saved label histories and exports.
- Integrity of source citations and nutrition readings.

## Trust boundaries

The browser reads images locally and stores selected blobs in memory. A user action is required to invoke public research. A separate checkbox is required before sending label text, a question and optional profile to Gemini. Image bytes are resolved from a selected browser handle and only sent on a visible action; server validation checks MIME signature, decoded dimensions and encoded size and strips metadata. Provider and public-source responses are untrusted data. Their strings are rendered as text.

Local API routes enforce same-origin loopback use, fixed destinations, bounded request/response sizes, timeouts and in-process concurrency/request budgets. These checks are not authentication, tenant isolation, durable distributed rate limits or production-grade abuse protection.

## Risks and controls

| Risk | Present control | Residual risk |
|---|---|---|
| Secrets enter version control | `.env*` ignored; placeholder `.env.example`; stage audit before commit | No remote exists; local repository hygiene still requires review |
| Private images/health data are committed | `docs/evidence/private/` and owner handoff bundle ignored; profile/images not persisted by default | Public manifest links and exported label text still require review |
| Misread OCR becomes a factual value | Keep observations, require explicit basis, preserve duplicate conflicts and withhold implausible values | OCR character error and language/layout coverage remain weak |
| Source/model text tries to control behavior | No HTML rendering; inputs treated as data; structured model schema and cited-ID membership checks | Citation membership is not entailment or source authenticity |
| Unintended provider transmission | Gemini disabled without owner config and explicit request consent | Enabling requires a key/cost decision and external provider data policies apply |
| Public endpoint abuse | Strict local origin, allowlists, request and response bounds, timeouts | Not suitable as a public unauthenticated deployment |
| Health details appear in storage/export | Profile memory only; omitted from IndexedDB and JSON export | Session data remains visible to anyone with browser access; user could type it in a public search field |

## Out of scope today

No production deployment, public network exposure, authentication, independent security scan, real Gemini use, or medical/regulatory acceptance has occurred. These are not implied by local tests or successful route-level fixtures.
