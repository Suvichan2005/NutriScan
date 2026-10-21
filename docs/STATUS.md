# Current engineering status

Updated: 2026-10-21. This is a local development application and research workspace. Feature levels below describe evidence available in this checkout; they do not imply clinical or production acceptance.

## Repository checkpoint

- Repository root: this directory; branch: `main`.
- Remote: none configured. No authorized private remote was supplied.
- First local milestone commit: `6f7b375` (`Build generalized NutriScan product investigation`). No earlier history or remote was present.
- Provider credentials: none configured; Gemini remains disabled and no provider request has been made.
- Deployment: none. Loopback-only API origin checks remain intended for local development.
- Product Design browser: Codex in-app browser remains disabled, but the current local app was exercised through Playwright in installed Chrome. Fresh 390 px mobile and 1440 px desktop screenshots and axe results are recorded in the [UX audit](UX_AUDIT.md).
- Real OCR diagnostics: five source-manifest photos / 37 annotated fields. Best current 3,000 px English Node pass matched 2, omitted 34 and withheld 1. Newly evaluated prepared AUTO yielded no unconflicted nutrient with a basis; prepared SINGLE_BLOCK yielded two such rows on one photo and two correct field matches overall. The five-photo set is too small to justify an automatic retry, so app behavior is unchanged. French, Spanish and combined language-specific probes parsed no fields on the selected pair. Current browser runs across four genuine photos produced no usable calculations; Saffola yielded two values with unknown basis. Full method and limits: [real OCR evaluation](REAL_OCR_EVALUATION.md).

## Verification matrix

| Capability | Current evidence level | Limits |
|---|---|---|
| Nutrition parsing and deterministic arithmetic | Unit-tested; synthetic evaluation executed | At this checkpoint 95 tests pass. Nutrient calculations cite both observed values and separate basis/serving declarations; identical readings retain links to each photo. Developer-authored fixtures are not an independent or photo benchmark. |
| Exact additive/source corpus and retrieval | Unit-tested; local-model evaluation refreshed; local references wired into audits | Eight entries; developer-authored 12-query ranking: lexical 11/12 top-1, MiniLM and hybrid 12/12 top-1. Intent-matched local references now appear in audits with source scope and limitations and enter consented synthesis context; unrelated and current-law questions do not receive ICMR dietary metadata as evidence. ICMR-NIN 2024 record is bibliographic metadata only; small tuning set, not independent scientific or clinical answer validation. |
| Local OCR on genuine packaging | Real browser-tested in earlier and current checkpoints | Current client-side runs covered 4 genuine photos in 3 investigations; none yielded a usable nutrient calculation. The app withheld garbled, conflicting or basis/unit-incomplete readings. A prior Nutella scan required human correction. |
| Repeatable OCR comparison on genuine packaging | Node diagnostic executed | 5 photos / 37 annotated fields; best 3,000 px pass 2 correct, 0 incorrect, 34 omitted and 1 withheld; prepared AUTO 0 usable-basis rows, prepared SINGLE_BLOCK 2 usable-basis rows on one photo. Not held-out or browser accuracy. |
| Product-label vs community-record nutrition comparison | Unit-tested; real-browser route tested | Explicit bases are normalized to 100 g/ml; missing, conflicted and mismatched values stay incomparable. Browser check used a synthetic label fixture against a live Open Food Facts record; this does not prove package identity or real-package agreement. |
| Product candidate discovery | Unit-tested; live localhost route tested | Global candidates work without a country; a user-entered country optionally filters community country tags. The current barcode is excluded when provided. A live oats query returned four candidates with `100 g` metadata; neither better formulation nor local stock was inferred. |
| Official Gazette PDF retrieval | Implemented; parser and date-separation fixture-tested; live route fallback-tested | FSSAI source registry has a fixed 2026 amendment PDF with publication/effective dates. Bounded PDF.js extraction is tested; prior local probe returned `text/html`, and a 2026-10-21 Windows TLS probe reported `CRYPT_E_REVOKED` for the official page and PDF. A built-app route probe returned two official navigation-only links while preserving `unavailable`; no live regulatory text was received. |
| Neutral starting amount | Unit-tested; typechecked | Declared serving or readable label basis is preferred; otherwise a 100 g/ml reference is used and labeled as non-personal. Fresh browser review of the changed wording is pending. |
| Variable image intake and general optional profile | Implemented; typechecked, unit-tested, mobile/desktop browser-tested | One and two-photo flows opened; profile controls empty. Replace/remove, hardware camera and complete keyboard review remain untested. |
| Add photos to an active investigation | Implemented; typechecked; unit-tested | New/changed photos are OCRed without rerunning unchanged attachments; observations keep image provenance. Evidence merges into the same package and preserves chat, portion and package identity. Comparable disagreements are marked conflict; barcode, brand and license mismatch warn. Identical values retain links to both sources. Fresh browser verification is pending. |
| Public product/science endpoints | Live public-source HTTP tested in earlier checkpoint | Records are candidates; variant/market/currency/freshness constraints remain |
| Optimized local app startup | Production build and localhost HTTP-tested | Built app returned HTTP 200 and the local status endpoint returned `ok`; Gemini was disabled. No browser interaction is implied by this route check. |
| Dependency advisory audit | `npm audit` and `npm audit --omit=dev` passed | Both reported zero known vulnerabilities at the time of this checkpoint; this is not a substitute for ongoing updates or a full security assessment. |
| Gemini assist and vision | Implemented only; provider explicitly disabled | No credentials, no actual provider invocation, no quality claim |
| Local phone camera and performance | Untested | Requires a real phone on a trusted origin |
| Production deployment/security | Not implemented or verified | Authentication, production rate limits, hosting and operational controls are absent |

## Recent generalization correction

The former profile contained one example-specific meal calculator. That schema, extraction helper, production arithmetic, and associated prompt-like UI have been removed. Context now has empty, separate optional fields for dietary preferences, food allergies, food intolerances, health considerations, goals, age group, sex/reference group and location. Allergy and intolerance context stay separate in the UI and prompt assembly; neither is a diagnosis. No default user, diagnosis, goal, country or eating pattern is installed; if every field is blank, the optional Gemini request omits the profile object entirely.

The scanner now supports up to 10 additive image attachments, per-image removal/replacement, optional role hints and notes, a selectable OCR crop target, product descriptions and an initial natural-language question. Existing per-photo OCR still runs locally. Users can start with details alone, paste text, or add images; an image marked as the front or back is optional.

Optional product details now enter the structured package record as a separately sourced user observation, not as OCR label text. The local audit marks them as unverified context, and the Gemini prompt preserves that distinction. Pasted label text can enrich an existing investigation or be analyzed while photos remain attached for a subsequent OCR read. Saved-scan and export disclosures now include user-provided product details. These joined flows are unit-tested and build-verified, but await fresh browser acceptance.

Adding photos after the first analysis now enriches the active investigation. Each extracted observation carries its source image ID, and unchanged photos are skipped on incremental reads. Re-reading all photos remains available. Merging retains existing identity, portion and conversation; identical evidence is deduplicated, different readings on compatible bases remain visible as conflicts, and changed barcode, brand or license evidence triggers an explicit product-identity warning. Package-dependent external results are cleared after evidence changes. Automated tests cover preservation, provenance, deduplication, disagreement, incompatible mass/volume bases and identity mismatch. This change has not yet received fresh real-browser verification.

The calculation control no longer falls back to the sample fixture's 30 g when a real package has no declared serving. It prefers the package's declared serving, then a non-conflicted nutrient basis, and otherwise uses a clearly labeled 100 g/ml comparison reference. This is an amount for transparent arithmetic, not a personal serving recommendation. Regression tests cover each branch; the new visual wording still needs a fresh screenshot review.

User-declared allergies and intolerances are separate in the profile contract, UI and local reasoning context. When entered, the local audit can surface literal text matches in extracted ingredient/allergen wording, tied to their supporting observations. A non-match is not a safety clearance; synonyms, derivatives, OCR omissions and cross-contact are not inferred. Fresh screenshots of the new context fields are pending browser access.

## Owner-dependent items

See [owner actions](OWNER_ACTIONS.md) for the consolidated list: authorized Gemini project/key and cost decision; paired, real-market product labels for OCR evaluation; an authorized live route for product-specific, current legal verification; an approved private Git remote if sharing is wanted; and hosting plus real-device decisions. Fresh screenshots of the incremental-photo path require the user's selected browser (the Product Design audit workflow still awaits that selection). A dated FSSAI amendment snapshot is recorded in [REGULATORY_SNAPSHOT.md](REGULATORY_SNAPSHOT.md).
