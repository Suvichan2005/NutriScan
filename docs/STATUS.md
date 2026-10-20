# Current engineering status

Updated: 2026-10-21. This is a local development application and research workspace. Feature levels below describe evidence available in this checkout; they do not imply clinical or production acceptance.

## Repository checkpoint

- Repository root: this directory; branch: `main`.
- Remote: none configured. No authorized private remote was supplied.
- First local milestone commit: `d34609bd8503c3f54750fb42fa4cf4e5b299e416` (`Build generalized NutriScan product investigation`). No earlier history or remote was present.
- Provider credentials: none configured; Gemini remains disabled and no provider request has been made.
- Deployment: none. Loopback-only API origin checks remain intended for local development.
- Product Design browser: current CUA inventory returned no browser and reported “Local browser use is disabled in Work settings.” This turn cannot produce a fresh screenshot audit; see [UX audit](UX_AUDIT.md).

## Verification matrix

| Capability | Current evidence level | Limits |
|---|---|---|
| Nutrition parsing and deterministic arithmetic | Unit-tested; synthetic evaluation executed | Developer-authored fixtures; not an independent or photo benchmark |
| Exact additive/source corpus and retrieval | Unit-tested; prepared local-model evaluation executed in prior checkpoint | Small corpus; not scientific or clinical answer validation |
| Local OCR on genuine packaging | Real browser-tested in earlier checkpoint | One Indian label was only partially read; another needed manual correction; current dynamic intake changes need a new browser run |
| Variable image intake and general optional profile | Implemented; typechecked and unit-tested | Fresh UI interaction and accessibility screenshot review blocked by browser setting |
| Public product/science endpoints | Live public-source HTTP tested in earlier checkpoint | Records are candidates; variant/market/currency/freshness constraints remain |
| Gemini assist and vision | Implemented only; provider explicitly disabled | No credentials, no actual provider invocation, no quality claim |
| Local phone camera and performance | Untested | Requires a real phone on a trusted origin |
| Production deployment/security | Not implemented or verified | Authentication, production rate limits, hosting and operational controls are absent |

## Recent generalization correction

The former profile contained one example-specific meal calculator. That schema, extraction helper, production arithmetic, and associated prompt-like UI have been removed. Context now has empty, separate optional fields for dietary preferences, allergies/intolerances, health considerations, goals, age group, sex/reference group and location. No default user, diagnosis, goal, country or eating pattern is installed.

The scanner now supports up to 10 additive image attachments, per-image removal/replacement, optional role hints and notes, a selectable OCR crop target, product descriptions and an initial natural-language question. Existing per-photo OCR still runs locally. Users can start with details alone, paste text, or add images; an image marked as the front or back is optional.

## Owner-dependent items

See [owner actions](OWNER_ACTIONS.md) for the consolidated list: authorized Gemini project/key and cost decision; paired, real-market product labels for OCR evaluation; current official regulatory documents or an authorized live source; an approved private Git remote if sharing is wanted; and hosting plus real-device decisions.
