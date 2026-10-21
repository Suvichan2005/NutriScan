# UX and browser evidence

Updated: 2026-10-21. The Codex in-app browser is disabled in Work settings, so this review used the locally installed Google Chrome through Playwright 1.64 against the running local NutriScan app. Screenshots came from the actual browser at 390 × 844 and 1440 × 1000 CSS pixels. The Next.js development badge was hidden in the saved captures; product UI was not altered for the screenshots.

## Verified journeys

- First visit: no product or question is prefilled. The optional-context dialog opened with all eight profile controls empty.
- Text-only investigation: entered a label and asked “How much sodium is in 50 g?” The app parsed the supplied label, displayed a 50 g portion and reported 200 mg sodium. A follow-up asking for 25 g updated the same package and returned 100 mg sodium, with no rescan.
- Mobile and desktop first-visit screens rendered without browser page errors. Axe reported zero violations on the mobile first visit, mobile result/follow-up page, and desktop first visit.
- Product comparison: a controlled 25 g label fixture was compared in-browser with a live Open Food Facts barcode record. Values normalized to 100 g matched the community values; database-only fields remained “not comparable.” The horizontally scrollable comparison is keyboard-focusable. Axe found no violations after that repair. This verifies the transformation and UI, not same-package photo agreement.
- Mobile visual inspection found that “New investigation” and “Add optional context” wrapped in the narrow workspace bar. A mobile CSS adjustment keeps the controls on one line and raises the smallest intake/helper text to 12 px. The fresh mobile capture confirms the wrap is resolved.
- Real browser OCR: one Saffola photo, one Bagrrys photo, and a two-photo Coca-Cola investigation (four genuine public source photos total) were run through the app's current 3,000 px, quality-98 client preparation. No case produced a usable nutrient calculation. Saffola exposed two visually matching nutrient values but no basis, so they remained withheld; Bagrrys returned ambiguous multi-column readings that stayed in conflict; the Coke OCR lacked a reliable value/unit/basis combination. The app left calculated nutrient values unknown. These results are separate from the Node diagnostic and are not a population accuracy estimate.

## Screenshots

- [First visit on mobile, 390 px](evidence/08-first-visit-mobile-390.png)
- [Text-only question and follow-up on mobile, 390 px](evidence/09-text-only-followup-mobile-390.png)
- [First visit on desktop, 1440 px](evidence/10-first-visit-desktop-1440.png)
- Real-photo OCR screenshots remain under ignored `docs/evidence/private/` because they display source package photographs and raw label text.

## Remaining acceptance work

- The photographed labels still fail to yield reliable nutrient calculations automatically. Test an explicitly selected nutrition-panel hint and a tightly targeted crop on real labels; do not weaken ambiguity handling to improve yield.
- A real photo from the same package as each product identity, direct camera hardware, replace/remove interactions, keyboard focus order, color contrast, and the consented Gemini image-selection flow still need dedicated acceptance.
- The Codex in-app screenshot/control route remains unavailable. The Playwright browser runs do not establish phone performance, camera permission behavior, or a fresh interactive audit of every research/results panel.

## Fresh screenshot-grounded audit — 21 October 2026

This pass used the optimized local build on a temporary loopback port and an isolated Google Chrome session through Playwright (390 × 844 mobile and 1440 × 1000 desktop). The in-app browser remains disabled. All screenshots below were saved locally and inspected after capture. The journey uses only an explicitly selected synthetic label plus public Open Food Facts data; it does not represent a real matching package.

1. **First visit, mobile and desktop** — [mobile screenshot](evidence/11-first-visit-mobile-390.png), [desktop screenshot](evidence/12-first-visit-desktop-1440.png). The user can begin with photos, details, or pasted text; no product or personal context is prefilled. The sample path is clearly marked synthetic. Mobile first-visit axe scan had zero violations; neither screenshot had a page error.
2. **Explore a sample** — [mobile screenshot](evidence/13-synthetic-label-mobile-390.png). The app labels the data as synthetic and presents a readable package summary and local calculations only after the user selects the sample. Axe found zero violations; no page errors.
3. **Optional context** — [mobile screenshot](evidence/15-optional-context-mobile-390.png). Dietary preferences, food allergies, intolerances and health context are separate; all nine text controls were empty. The dialog says values remain in the session and are sent only with explicit Gemini consent. Axe found zero violations.
4. **Conversational follow-up** — [mobile screenshot](evidence/14-synthetic-followup-mobile-390.png). Asking “How much sodium is in 25 g?” updated the same sample package and returned 212.5 mg, without rescanning. Axe found zero violations; no page errors.
5. **Population-scope guard** — [mobile screenshot](evidence/16-under18-sodium-context-mobile-390.png). After explicitly entering “16 years,” asking about blood pressure retained the sample-label calculation (255 mg in the current 30 g amount) but displayed “Adult sodium reference not applied” and requested age-specific guidance. It did not show the general-adult percentage or infer a pediatric target. Axe found zero violations; no page errors.
6. **Catalog comparison and identity wording** — [desktop screenshot](evidence/17-sparse-catalog-comparison-desktop-1440.png), [mobile screenshot](evidence/18-sparse-catalog-comparison-mobile-390.png). A live exact-barcode query returned the Open Food Facts record for White Oats. The sample label's added-sugars value (0 g/100 g) remains visible while the absent catalog value is labeled “No matching community-record value” and “Not comparable.” The footer distinguishes an exact search-field match from package identity; because the synthetic package has no barcode, it explicitly says exact package identity is unverified. This verifies sparse-record presentation, not nutritional agreement with a real White Oats package. Both viewport axe scans had zero violations and no page errors. On mobile, the comparison region was 314 px wide with a 640 px table, accepted keyboard focus, and contained the horizontal scroll without widening the 390 px page.

The initial screenshot review exposed wording that called a record an “identity match” when only the search-field barcode matched. That copy was corrected before the final comparison screenshots; unit tests cover exact query match with absent package barcode, differing package barcode, and matching recorded barcode.

These checks establish the named rendered flows only. They do not establish full keyboard-order accessibility, phone camera permissions, real-device performance, photo replacement/removal, genuine-photo OCR success, live Gemini behavior, or exact real-package formulation agreement.
