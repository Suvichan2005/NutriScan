# Real package OCR diagnostic

Updated: 2026-10-21. Reproduce with `npm run ocr:evaluate` after the private evaluation photographs have been provisioned locally. The command verifies every photograph against the SHA-256 in `data/semantic-photo-manifest.json`, runs the installed Tesseract.js English model, compares parsed values with the manifest's human visual annotations, and writes `docs/evidence/real-ocr-evaluation.json`. It does not write source images or raw OCR text into the result.

## Current result

Five genuine Open Food Facts package photographs were evaluated: three English panels, one French panel and one Spanish panel, with 37 human-read nutrient fields. With the current 3,000 px, quality-98 preparation, the single-block pass matched **2 fields, had 0 incorrect, omitted 34 and withheld 1**. That is 2/37 matched annotated fields (5.4%) for this small diagnostic set. The grayscale/normalize/sharpen pass also matched 2, with 0 incorrect, 33 omitted and 2 withheld. English-only modes read 0 of 7 French fields and 0 of 7 Spanish fields. An English native-image automatic-page pass returned two incorrect values, including a sodium value read ten times too high on the Saffola photograph. Sparse-text mode omitted all 37 fields.

Reproduced from the current checkout on 21 October 2026 with `npm run ocr:evaluate`; the generated field-level output and all mode totals matched these recorded counts. No OCR pipeline change was made based on this rerun.

The benchmark also covers the browser-prepared image in automatic, single-column and single-block segmentation. Prepared AUTO matched 0, incorrectly matched 0, omitted 36 and withheld 1; its parser emitted no unconflicted nutrient with an explicit basis across these photos. Prepared SINGLE_COLUMN omitted all 37. Prepared SINGLE_BLOCK matched the 2 fields above and produced two unconflicted, explicit-basis nutrient rows, both on one photo. AUTO did not produce a usable-basis row that could be recovered by switching modes; the one photo where SINGLE_BLOCK recovered usable rows is not enough evidence to add a second OCR pass to every ambiguous image. It remains a candidate for broader evaluation, with the existing fail-closed behavior retained.

The low yield is useful evidence: preprocessing alone did not make these five photos reliably machine-readable, and false numeric readings remain a material risk. The segmentation comparison is exploratory and does not support a population accuracy estimate or a claim that one image mode is generally better. Keep uncertain values withheld and ask for a closer, flatter, well-lit photo or exact-product corroboration where warranted.

## User-directed crop experiments

### Browser UI confirmation on one photo

`npm run ocr:evaluate:browser-ui` exercises the production client-side upload and OCR workflow through local Chrome at a 390 × 844 viewport. It verifies the ignored source image against the manifest SHA-256, then runs unknown-role/full-image, nutrition-role/full-image, and the same nutrition-role crop twice. The result receipt is [real-ocr-browser-ui-probe.json](evidence/real-ocr-browser-ui-probe.json); screenshots remain under the ignored `docs/evidence/private/` directory.

On the Saffola photograph / nine annotated fields, the unknown-role run produced 0 nutrient rows (0 correct, 0 incorrect, 9 omitted). The nutrition-role full-image run produced two rows but no exact-basis annotated match (0 correct, 0 incorrect, 8 omitted, 1 withheld). The user-selected crop (x 3%, y 0%, width 93%, height 99%) produced one exact-basis match in both repeated runs (1 correct, 0 incorrect, 8 omitted, 0 withheld). All four browser runs had zero page errors and zero axe violations. The repeat supports reproducibility for this single browser/photo/crop configuration only.

This differs from the earlier Node crop proxy, where the same bounds removed both recovered Saffola values. The Node `sharp` proxy and browser canvas path are distinct processing paths; this observation does not establish that browser cropping generally improves OCR. It does not justify an automatic crop, retry, or default-role change. The successful field remains one human-annotated package observation, not laboratory or formulation verification.

The command requires the ignored source photo and an already-running local production server; for example, run `npm run build` then `npx next start --hostname 127.0.0.1 --port 3413`. Set `NUTRISCAN_BASE_URL` to select another loopback origin. The script rejects non-loopback origins. It writes only aggregate field outcomes, hashes, accessibility IDs, error counts and screenshot paths to the tracked receipt—never OCR text or image bytes.

### Earlier Node proxy result

`npm run ocr:evaluate:guided-crops` compares a full-frame 3,000 px proxy with one user-selected-style crop on two difficult Indian English labels: Saffola Veggie Twist Oats and Bagrry's White Oats. Both variants use English Tesseract `SINGLE_BLOCK`, matching the app's existing nutrition-panel role; only the image crop changes. Crops are expressed as percentages of the EXIF-oriented original. Saffola's interior crop removes a narrow outer border (x 3%, y 0%, width 93%, height 99%). Bagrry's crop keeps the label heading and first `per 100 g` column while excluding the adjacent `per 35 g` column (x 2%, y 2%, width 74%, height 96%). Each crop retains the basis header; the Bagrry's crop also drops the serving-size footer.

On the 17 annotated fields, full-frame scored 2 correct, 0 incorrect, 14 omitted and 1 withheld. The two matches were Saffola fat and saturated fat; Bagrry's matched none. The two crops together scored 0 correct, 0 incorrect, 15 omitted and 2 withheld. The tighter Bagrry's crop did not resolve the two-column label, while the Saffola crop removed readings that the full frame recovered. Do not promote either crop to an automatic default. Machine-readable results, including field-level outcomes and exact crop bounds, are in [the guided-crop probe](evidence/real-ocr-guided-crop-probe.json).

This is a Node experiment, not browser acceptance. It does not exercise canvas crop selection, UI role assignment, the browser worker, or image geometry correction. It covers only two selected photos and must not be generalized into a crop or OCR-accuracy claim.

## Method and limits

- Sources: the five public product photographs listed in the local semantic photo manifest, selected with explicit human-read values and bases. The local image copies are ignored by Git.
- Modes: English Tesseract automatic, single-block and sparse-text segmentation on source bytes; automatic, single-column and single-block on a rotated/resized 3,000 px JPEG proxy at quality 98, matching the current browser target; and single-block on a grayscale/normalized/sharpened proxy at the same size and quality. Per-photo diagnostics also record parser row, basis and conflict counts, ingredient-line counts and claim counts, without retaining OCR text.
- Comparison: values are parsed with the production `parseLabel` function and counted only at the explicitly annotated basis. Energy and sodium units are normalized for comparison; a tolerance of the larger of 0.015 or 0.5% is applied. Values on another basis do not count as a match. Conflicted readings are withheld.
- This is a Node diagnostic, not a browser end-to-end run. The browser's actual Canvas image preparation, worker loading, user flow, and rendered result were not exercised in this run.
- English trained data only was used. The French and Spanish results show the current language-model limitation; no translation or corrected text was injected.
- The sample is small and was selected rather than randomly sampled. Annotations were made by visual inspection, not independently blinded. Product revision/market identity, ingredient reading, claims, and legal/health interpretation are outside this metric.
- Results do not establish label truth, current formulation, overall OCR accuracy, clinical suitability, or general product performance. Do not treat this set as held-out acceptance data.

See the machine-readable [field-level results](evidence/real-ocr-evaluation.json) and the broader [status](STATUS.md), [acceptance record](ACCEPTANCE.md), and [data provenance](DATA_PROVENANCE.md).

## Optional French/Spanish model probe

The baseline uses English data only. To test whether model-language mismatch explained the two non-English failures, I installed French and Spanish Tesseract.js data packages locally with `--no-save`, then ran `npm run ocr:evaluate:languages`. The optional script verifies photo hashes and compares French-only, Spanish-only, and English-plus-matching-language workers in automatic and single-block modes. It writes [a field-level summary](evidence/real-ocr-language-probe.json) without adding raw OCR text or image bytes.

Across the eight runs, all 56 per-run field comparisons were omitted and the production parser returned zero nutrient rows. Neither language-specific recognition nor its English-plus-language combination detected an unambiguous basis on these source photos. This probe does not show that the language models are generally ineffective; on this selected pair, language support alone did not resolve image geometry, column, or text-recognition problems. The French/Spanish model packages are intentionally not project dependencies and are not copied into the browser bundle.

Reproduce on a checkout with the ignored source photographs by running:

```powershell
npm install --no-save --package-lock=false --ignore-scripts '@tesseract.js-data/fra@1.0.0' '@tesseract.js-data/spa@1.0.0'
npm run ocr:evaluate:languages
```

## Image preprocessing probe

I also compared six single-block passes on the hash-verified Saffola panel: native pixels, 3,000 px upscaling, grayscale/normalize/sharpen at 3,000 px, isolated green or blue channels, and a hard green-channel threshold. The 3,000 px and grayscale passes each matched 2 of 9 annotated values with no wrong fields; grayscale also withheld one. Isolating a channel or thresholding matched none. The result is recorded in [the preprocessing probe](evidence/real-ocr-preprocessing-probe.json) and can be regenerated with `npm run ocr:evaluate:preprocessing`.

The six-variant Saffola probe is only a selected single-photo result. At 3,000 px, the real browser also surfaced the expected 9.9 g fat and 3.4 g saturated-fat readings on the annotated 100 g label, but failed to read their basis; both remained withheld from calculation. The full five-photo 3,000 px proxy increased exact-basis matches from 1/37 to 2/37 without an incorrect match in the prepared/enhanced modes. On this evidence the browser now uses a 3,000 px target at JPEG quality 98, while the parser still requires an unambiguous basis and withholds conflicting values. This small gain does not establish a population or mobile-performance benefit; larger photo sets and real devices remain to be tested.

## Larger-image scaling probe

To check whether still larger pixel dimensions helped the same recognition boundary, `npm run ocr:evaluate:upscale` compared 3,000, 4,500 and 6,000 px maximum long-edge JPEGs at quality 98 using English Tesseract `SINGLE_BLOCK` on the same five hash-verified photos / 37 annotated fields. The 3,000 px result matched 2/37 with 0 incorrect, 34 omitted and 1 withheld; both 4,500 and 6,000 px matched 0/37 with 0 incorrect (35/36 omitted and 2/1 withheld respectively). Machine-readable counts are in [the scale probe](evidence/real-ocr-upscale-probe.json). This exploratory result does not establish that scaling causes the difference beyond this selected set, but it provides no evidence to raise the browser's current 3,000 px cap. No runtime OCR behavior changed.
