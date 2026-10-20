# Real package OCR diagnostic

Updated: 2026-10-21. Reproduce with `npm run ocr:evaluate` after the private evaluation photographs have been provisioned locally. The command verifies every photograph against the SHA-256 in `data/semantic-photo-manifest.json`, runs the installed Tesseract.js English model, compares parsed values with the manifest's human visual annotations, and writes `docs/evidence/real-ocr-evaluation.json`. It does not write source images or raw OCR text into the result.

## Current result

Five genuine Open Food Facts package photographs were evaluated: three English panels, one French panel and one Spanish panel, with 37 human-read nutrient fields. The best tested pass was a Node Tesseract single-block read on a browser-prepared-image proxy: **1 correct, 0 incorrect, 34 omitted and 2 withheld**. This is 1/37 matched annotated fields (2.7%) for this small diagnostic set. English-only modes read 0 of 7 French fields and 0 of 7 Spanish fields. An English native-image automatic-page pass returned two incorrect values, including a sodium value read ten times too high on the Saffola photograph. The enhanced pass returned one correct, one incorrect and 35 omitted fields. Sparse-text mode omitted all 37 fields.

The low yield is useful evidence: preprocessing alone did not make these five photos reliably machine-readable, and false numeric readings remain a material risk. It does not support a population accuracy estimate or a claim that one image mode is generally better. Keep uncertain values withheld and ask for a closer, flatter, well-lit photo or exact-product corroboration where warranted.

## Method and limits

- Sources: the five public product photographs listed in the local semantic photo manifest, selected with explicit human-read values and bases. The local image copies are ignored by Git.
- Modes: English Tesseract automatic, single-block and sparse-text segmentation on source bytes; single-block on a rotated/resized JPEG proxy matching the browser's target dimensions and quality; and single-block on a grayscale/normalized/sharpened proxy.
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

The five-photo 3,000 px proxy remained at 1/37 exact-basis matches, tied with 2,200 px, while the enhanced full-sample pass regressed to 0/37. In a real browser run with a nutrition-panel hint, 3,000 px exposed additional Saffola numeric text, but not a reliable printed basis; duplicate and basis-unknown values remained withheld. Increasing the default image size therefore did not establish a safe end-to-end benefit, so production remains at 2,200 px. This optimization experiment is evidence for future crop/deskew work, not an accepted automatic value-reading improvement.
