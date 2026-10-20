# Acceptance record

Updated 2026-10-21 from the current checkout. “Implemented” describes code presence only. The Codex in-app browser is disabled in Work settings; earlier same-day Chrome/Playwright mobile and desktop journeys are documented below. A new screenshot journey for the current reference-amount change is pending browser access.

| Requirement | State | Evidence or remaining check |
|---|---|---|
| First visit has no inferred health, age, dietary, location or goal profile | Implemented; unit-tested; browser-tested before latest profile-field split | Empty `defaultProfile` and strict schema are tested. Earlier browser inspection showed the optional controls blank; a fresh screenshot is still needed for the revised separate allergy and intolerance controls. |
| Food allergies remain distinct from food intolerances | Implemented; unit-tested | Separate schema fields, UI labels and model-context labels; no diagnosis or individual-safety conclusion is implied. Fresh visual/accessibility check pending. |
| No example-specific meal/condition workflow in production context | Implemented; unit-tested | Legacy profile fields rejected; source scan and static tests; sample label remains a clearly marked user-selected fixture |
| Variable photos and no mandatory front/back pair | Implemented; browser-tested | Current browser ran one-photo and two-photo input; remove/replace, camera hardware and full interaction review remain pending |
| Product-only or text-only starting path with open question | Implemented | Client route parses supplied details and retains the question; exact product research stays a separate explicit source action |
| OCR runs locally | Real browser-tested in earlier and current checkpoints | Current app ran four genuine package photos in Chrome with the 3,000 px, quality-98 path; no photo produced a usable nutrient calculation. Saffola yielded two values with unknown basis; conflicts and missing units/bases were withheld. Earlier Nutella values needed human correction. |
| First question's portion and conversational follow-up | Unit-tested; real browser-tested | A first 50 g question set a 50 g portion and showed 200 mg sodium; a 25 g follow-up updated it to 100 mg without rescanning. |
| Neutral starting amount without a package serving | Unit-tested; typechecked | Uses an explicit label serving or unconflicted label basis; otherwise starts at a standardized 100 g/ml reference that is labeled as non-personal. No 30 g runtime fallback remains. Fresh browser visual check pending. |
| Repeatable real-photo OCR comparison | Node diagnostic executed | 5 photos / 37 human-read nutrient fields; best tested pass 2 correct, 0 incorrect, 34 omitted, 1 withheld; English-only model matched no French or Spanish fields. See [method and limitations](REAL_OCR_EVALUATION.md). This is not browser E2E or a population accuracy estimate. |
| Nutrition scaling, conflicts and missing values | Unit-tested; synthetic evaluation executed | `npm test`, `npm run evaluate`; not a real-photo accuracy score |
| Follow-ups preserve package data and use the user's new question | Unit-tested | Deterministic local answers; unsupported open topics still need question-specific research or enabled Gemini |
| Public-source API boundaries | Live-source HTTP tested in earlier checkpoint | Date, market, identity and inventory caveats documented in `INTEGRATIONS.md` |
| Compare package nutrition with an external product record | Unit-tested; live browser route tested | A synthetic 25 g label fixture was normalized to 100 g and compared with a live barcode record; equivalent values matched. Missing label nutrients were marked not comparable. Real same-package formulation agreement remains unverified. |
| Search alternative product candidates | Unit-tested; live localhost route tested | Global community-catalog candidates can be searched without a profile country; a supplied country is an optional country-tag filter, and the current barcode is excluded. A live oats probe returned four candidates with explicit 100 g bases. This is candidate discovery, not proof of stock or a better formulation. |
| Gemini text and image calls | Implemented only | Disabled; no credential, spend, or live output verification |
| Mobile and desktop screenshots/accessibility | Current Playwright screenshots and axe runs | Fresh mobile 390 px and desktop 1440 px captures; zero axe violations on mobile first visit/results and desktop first visit. Camera, keyboard, contrast and phone behavior remain untested. |
| Private data and Git hygiene | Verified for this local checkpoint | Staged-path/ignore checks passed; first commit is local and no remote is configured |

## Synthetic core evaluation

The developer-authored 20-case suite last recorded 29/29 annotated field comparisons, 4/4 absences, 11/11 withholding checks and 19 numerical comparisons. Maximum absolute calculation error was about 5.42e-20 due to floating-point representation. This validates the current fixture set and arithmetic implementation only; it does not measure OCR accuracy, model answer quality, or real-world suitability.
