# UX audit record

## Current run

Product: NutriScan local web application. Intended journey: start with a product image, product description or label text; ask a question; inspect the result and sources; then continue with a user-written follow-up.

Capture tool: Codex in-app browser through CUA. The fresh tool inventory returned no browser and the explicit error “Local browser use is disabled in Work settings.” The installed Product Design audit workflow requires current browser screenshots and stops when the selected browser cannot capture or control the product. Therefore this run did not complete a screenshot-grounded UX audit, did not reuse prior screenshots as current evidence, and does not claim visual or accessibility acceptance.

The current code-based interaction review found a rigid two-slot photo intake, example-specific profile inputs, a preset condition/meal placeholder, and three fixed follow-up chips. These findings were confirmed in source, not from screenshots. The current changes replace those controls with a flexible photo collection, optional free-text profile categories and a natural-language question field; visual quality, keyboard flow and responsive layout still require browser confirmation.

## Required follow-up capture

When the Codex in-app browser is enabled, capture and inspect fresh screenshots for:

1. First visit with no profile, product, or question.
2. One-photo upload and OCR progress/result.
3. Multiple images with remove/replace, one optional hint, and crop targeting.
4. Product details plus a typed question without a photo.
5. Optional context with blank fields and separately entered preferences/restrictions.
6. Ingredient or nutrition result, evidence/source expansion, and a typed follow-up.
7. Image-selection and consent disclosure in the Gemini panel while the provider is disabled.
8. Mobile widths around 360–390 px and desktop around 1440 px; inspect keyboard focus and contrast in addition to screenshots.

Prior run screenshots remain stored under `docs/evidence/`, but are not evidence for this changed interaction architecture.
