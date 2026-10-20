# Acceptance record

Updated 2026-10-21 from the current checkout. “Implemented” describes code presence only. The available in-app browser was disabled during the current audit attempt; no current screenshot journey is claimed.

| Requirement | State | Evidence or remaining check |
|---|---|---|
| First visit has no inferred health, age, dietary, location or goal profile | Implemented; unit-tested | Empty `defaultProfile`, strict schema and regression cases; visual browser confirmation pending |
| No example-specific meal/condition workflow in production context | Implemented; unit-tested | Legacy profile fields rejected; source scan and static tests; sample label remains a clearly marked user-selected fixture |
| Variable photos and no mandatory front/back pair | Implemented | Up to 10 inputs, camera, previews, remove/replace, role hints, note and crop target; real browser interaction pending |
| Product-only or text-only starting path with open question | Implemented | Client route parses supplied details and retains the question; exact product research stays a separate explicit source action |
| OCR runs locally | Real browser-tested in earlier checkpoint | Multiple real packages tried previously; incomplete readings remain, and current collection flow has not been re-tested |
| Nutrition scaling, conflicts and missing values | Unit-tested; synthetic evaluation executed | `npm test`, `npm run evaluate`; not a real-photo accuracy score |
| Follow-ups preserve package data and use the user's new question | Unit-tested | Deterministic local answers; unsupported open topics still need question-specific research or enabled Gemini |
| Public-source API boundaries | Live-source HTTP tested in earlier checkpoint | Date, market, identity and inventory caveats documented in `INTEGRATIONS.md` |
| Gemini text and image calls | Implemented only | Disabled; no credential, spend, or live output verification |
| Mobile and desktop screenshots/accessibility | Earlier mobile screenshot exists; current audit blocked | A new capture is required after browser access is enabled; prior screenshots are not treated as current evidence |
| Private data and Git hygiene | Verified for this local checkpoint | Staged-path/ignore checks passed; first commit is local and no remote is configured |

## Synthetic core evaluation

The developer-authored 20-case suite last recorded 29/29 annotated field comparisons, 4/4 absences, 11/11 withholding checks and 19 numerical comparisons. Maximum absolute calculation error was about 5.42e-20 due to floating-point representation. This validates the current fixture set and arithmetic implementation only; it does not measure OCR accuracy, model answer quality, or real-world suitability.
