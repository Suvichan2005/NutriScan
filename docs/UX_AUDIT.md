# UX and browser evidence

Updated: 2026-10-21. The Codex in-app browser is disabled in Work settings, so this review used the locally installed Google Chrome through Playwright 1.64 against the running local NutriScan app. Screenshots came from the actual browser at 390 × 844 and 1440 × 1000 CSS pixels. The Next.js development badge was hidden in the saved captures; product UI was not altered for the screenshots.

## Verified journeys

- First visit: no product or question is prefilled. The optional-context dialog opened with all eight profile controls empty.
- Text-only investigation: entered a label and asked “How much sodium is in 50 g?” The app parsed the supplied label, displayed a 50 g portion and reported 200 mg sodium. A follow-up asking for 25 g updated the same package and returned 100 mg sodium, with no rescan.
- Mobile and desktop first-visit screens rendered without browser page errors. Axe reported zero violations on the mobile first visit, mobile result/follow-up page, and desktop first visit.
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
