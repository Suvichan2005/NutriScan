# Current engineering status

Updated: 2026-10-21. This is a local development application and research workspace. Feature levels below describe evidence available in this checkout; they do not imply clinical or production acceptance.

## Repository checkpoint

- Repository root: this directory; branch: `main`.
- Remote: none configured. No authorized private remote was supplied.
- First local milestone commit: `6f7b375` (`Build generalized NutriScan product investigation`). No earlier history or remote was present.
- Provider credentials: none configured; Gemini remains disabled and no provider request has been made.
- Deployment: none. Loopback-only API origin checks remain intended for local development.
- Product Design browser: current CUA inventory returned no browser and reported “Local browser use is disabled in Work settings.” This turn cannot produce a fresh screenshot audit; see [UX audit](UX_AUDIT.md).
- Real OCR diagnostic: five source-manifest photos / 37 annotated fields. Best Node pass matched 1, omitted 34 and withheld 2; English-only OCR matched no French or Spanish fields. Full method and limits: [real OCR evaluation](REAL_OCR_EVALUATION.md). This diagnostic is not browser acceptance.

## Verification matrix

| Capability | Current evidence level | Limits |
|---|---|---|
| Nutrition parsing and deterministic arithmetic | Unit-tested; synthetic evaluation executed | Developer-authored fixtures; not an independent or photo benchmark |
| Exact additive/source corpus and retrieval | Unit-tested; prepared local-model evaluation executed in prior checkpoint | Small corpus; not scientific or clinical answer validation |
| Local OCR on genuine packaging | Real browser-tested in earlier checkpoint | One Indian label was only partially read; another needed manual correction; current dynamic intake changes need a new browser run |
| Repeatable OCR comparison on genuine packaging | Node diagnostic executed | 5 photos / 37 annotated fields; best pass 1 correct, 0 incorrect, 34 omitted and 2 withheld; not held-out or browser evidence |
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
