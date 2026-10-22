# Selective package extraction checkpoint — 22 October 2026

Integrated the official PP-OCRv5 browser SDK as a lazy second reader behind the existing Tesseract pass. The unchanged parser and observation merge retain ambiguous candidates; exact same-photo text agreement and explicit basis evidence can resolve a previously unbased row. No photo bytes leave the browser.

On five previously used development photos (37 annotated fields), the same-app Tesseract-only run scored 1 correct, 0 incorrect, 34 omitted and 2 withheld. The hybrid scored 6 correct, 0 incorrect, 23 omitted and 8 withheld. Gains were concentrated on two oat labels; three other labels remained at zero complete fields. Portion calculations then worked for automatically recovered fields. This is development evidence only, not held-out or population accuracy.

Fallback latency and asset cost are material: 30.96 seconds for the first scan and 12.91–15.74 seconds for later scans in one desktop Chrome session; first-load assets estimate about 60.9 MB. Mobile performance and memory remain unknown. Gemini was not called. The local beta-glucan follow-up surfaced unrelated sources and is not counted as a successful evidence answer.

The same browser run found two multilingual nutrition/table headings being shown as product names. A parser guard now blocks those heading and basis-only line classes; it has module test coverage but still needs a photo-browser recheck. Next work should address the three failed non-oat/language examples and improve label-product identity, using new independently annotated development products before selecting a wider deployment approach.
