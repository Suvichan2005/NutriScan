# OCR alternatives evaluation

Updated: 21 October 2026. This is a local diagnostic, not a product quality claim.

## Same-photo comparison

`npm run ocr:evaluate:rapidocr` compares the shipped browser Tesseract.js route's parsing on original and browser-prepared image bytes with RapidOCR 3.10.0 using PP-OCRv6 small models through ONNX Runtime on CPU. All three paths feed the same production `parseLabel` implementation. The RapidOCR path groups detected word boxes by vertical position and x-orders them into text rows before parsing. The checked inputs are the five hash-verified public Open Food Facts package photographs already annotated in `data/semantic-photo-manifest.json`; source images and raw recognized text are not copied to the output receipt.

| Engine and input | Exact annotated matches | Incorrect | Omitted | Withheld | Parsed rows | Explicit basis rows | Mean per-image time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Tesseract.js, original bytes | 0/37 | 1 | 34 | 2 | 4 | 1 | 1.8 s |
| Tesseract.js, EXIF rotation + 3,000 px max edge + JPEG 98 | 2/37 | 0 | 34 | 1 | 3 | 2 | 5.0 s |
| RapidOCR PP-OCRv6 small, CPU | 7/37 | 0 | 24 | 6 | 17 | 7 | 7.5 s |

The single-field Tesseract error occurred on the Saffola label. RapidOCR's seven exact matches were one Coca-Cola field and six Saffola fields. It returned no exact matches for either Nutella language photo or Bagrry's. On Bagrry's it found text and parser rows but no explicit nutrient basis; the parser withheld values instead of treating a nearby amount or column as the basis. This is the right safety outcome for unresolved column alignment, and also means this engine has not solved the usable-coverage problem.

The same CPU evaluator can be run with `NUTRISCAN_RAPIDOCR_MODEL_TYPE=tiny`. Tiny reduced detector+recognizer weights from about 31.2 MB to 6.32 MB. Full-photo inference varied from 3.1 to 5.4 seconds/image across runs; the two-crop run averaged 4.2 to 4.4 seconds/image. The refreshed small-model run averaged 7.4 seconds/image full-frame and 9.6 seconds/image on the two guided crops. Tiny's full-photo exact matches were 5/37 (versus 7/37 for small); on the hand-selected crops it matched 9/17 (versus 10/17 for small). It is faster and much smaller, but still slow on this CPU and did not improve measured usable coverage.

## Guided nutrition-panel crops

I also compared the same two manually selected regions that had already been tested with the production browser OCR: Saffola (3/0/93/99 percent) and the first Bagrry's nutrition column (2/2/74/96 percent). The RapidOCR script normalizes image orientation, resizes to the app's 3,000 px limit, and applies those regions before recognition.

| Engine and path | Exact annotated matches | Incorrect | Omitted | Withheld | Mean per-image time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tesseract.js, full-frame | 2/17 | 0 | 14 | 1 | Not recorded |
| Tesseract.js, selected crop | 0/17 | 0 | 15 | 2 | Not recorded |
| RapidOCR, full-frame | 6/17 | 0 | 6 | 5 | 8.7 s |
| RapidOCR, same selected crop | 10/17 | 0 | 7 | 0 | 9.8 s |

The crop result is a material improvement on these two English labels: RapidOCR emitted five correct fields for each crop, and five explicit per-100 g bases for each. Tesseract's corresponding crop readings produced no matches. This also resolves the earlier Bagrry's basis ambiguity for these selected crop pixels. It does not validate automatic panel detection, other brands, a population, or camera-captured input; the crop was selected by a human with knowledge of the benchmark image. Crop timing averages about 9.8 seconds per image on CPU.

## Browser WASM feasibility

`npm run ocr:evaluate:rapidocr:web` runs PP-OCRv6 detector and recognizer in desktop Chrome through ONNX Runtime Web's WASM CPU provider. The script serves hash-verified public benchmark crops and model weights from a temporary loopback-only server, computes detector heatmaps and recognizer output in the browser, groups activated rows with a deliberately simple vertical projection, and sends those recognized lines to the production parser. It writes only field-match counts and timing; no OCR text, photo bytes or remote requests are recorded. By default it runs the tiny-model baseline plus a bounded detector-threshold/row-gap sweep; set `NUTRISCAN_RAPIDOCR_MODEL_TYPE=small` to test the larger models.

On the Saffola and Bagrry's selected English panel crops, the tiny-model browser baseline matched 4/17 annotated fields, with no incorrect values; nine were omitted and four withheld. It recognized 17 and 22 text rows from those two crops, respectively. Per crop, the detector took about 0.30–0.36 seconds and recognition took 0.44–0.92 seconds on this desktop CPU. The manually cropped Saffola energy row was independently recognized as containing “Energy” and “376” at 0.93 mean character confidence. Browser OCR on Bagrry's did not recover an unambiguous basis, so its values remained withheld. Five bounded threshold/gap configurations produced 4/17, 4/17, 3/17, 4/17 and 4/17, all with no incorrect values; simple projection tuning did not explain the coverage gap.

A second extraction mode used thresholded, dilated connected components, approximate text-word boxes, and row grouping. This improved tiny's score to 6/17 (all six on Saffola; Bagrry's remained 0/8) with zero incorrect values. It recognized 17 Saffola and 33 Bagrry's rows. The same component mode with small models also scored 6/17: six Saffola fields and none on Bagrry's. The model-size increase did not recover the two-column label. These component results improve on simple projection, but still trail local Python small on the same crops (10/17) and omit eleven annotated fields. This establishes browser runtime feasibility and a better detector-output reader, not broad OCR accuracy.

To check whether the crop-only score generalized, I ran the same tiny browser detector and parser against all five hash-verified full photos / 37 annotated fields. The projection baseline matched 3/37 with zero incorrect, 33 omitted and one withheld; connected-component extraction matched 6/37 with zero incorrect, 30 omitted and one withheld. All six matches were on Saffola; Coca-Cola, both Nutella language photos and Bagrry's yielded no exact annotated matches. The connected-component pass took about 2.2 seconds of row recognition on the Saffola crop and 1.6 seconds on Bagrry's; cold model weights and WASM still add download cost. Full method and aggregate-only receipt: `docs/evidence/rapidocr-browser-full-photo-evaluation.json`.

The local tiny runtime assets measured 368 KB JavaScript, 14.26 MB WASM and 24 KB WASM module, in addition to 6.32 MB detector+recognizer weights. A separate small-model Chrome run used 31.16 MB of model weights and matched 3/17 fields at baseline; its other four threshold/gap configurations also matched only 3/17, while connected components reached 6/17. Both models scored the same 6/17 in component mode. Browser small did not beat browser tiny or local Python small (10/17); the six-configuration small-model run took over two minutes on this desktop. Neither prototype uses RapidOCR's full DB contour post-processing, loads a camera photo on a phone, or tests WebGPU acceleration. The project's existing Transformers.js dependency includes ONNX Runtime Web, but that fact alone does not show the OCR models or pipeline are already integrated into the product.

## TrOCR printed-text line-recognition probe

The existing Transformers.js dependency can load `Xenova/trocr-small-printed` locally. Microsoft's model card describes its base model for single text-line images, so I tested the quantized ONNX pipeline on separate nutrient-name and value cells from 13 manually bounded rows on the hash-verified Saffola photo. It matched both the annotated label and value on 1/13 rows, matched 2/13 labels and 4/13 values, and took 32.8 seconds warm on this desktop. The probe persisted only aggregate counts and no recognized text. It does not test automatic row/cell detection or establish a product-level score. This is not a useful second reader as configured: the app would first need a reliable detector, and this single-photo experiment did not recover a useful fraction of complete rows. Reproduce with `npm run ocr:evaluate:trocr`; model files are managed by the local Transformers.js cache and are not project dependencies or committed assets.

The Transformers.js model card lists quantized ONNX files of about 40.5 MB for the decoder and 23.1 MB for the encoder, before tokenizer and metadata files. Microsoft describes TrOCR as a single-line recognizer, not a nutrition-table parser. These size and task constraints, plus the one exact label-and-value pair in this single-photo probe, do not justify downloading the model for end users. The relevant primary references are the [Xenova ONNX model files](https://huggingface.co/Xenova/trocr-small-printed/tree/main/onnx) and [Microsoft model card](https://huggingface.co/microsoft/trocr-small-printed).

RapidOCR downloaded PP-OCRv6 small detector (9.9 MB), recognizer (21.2 MB) and angle classifier (0.6 MB), about 31.8 MB combined, into an ignored local virtual environment on first run. The five-photo plus two-crop reproducible CPU run took 58.0 seconds; observed full-frame inference averaged 7.4 seconds per image and guided-crop inference averaged 9.8 seconds. It is a Python process rather than a browser bundle, so this evaluation does not establish phone performance, browser feasibility, warm-start behavior across application requests, or production deployment suitability. The basic row reconstruction is diagnostic code, not a general table model.

## Reproduction

Requires the already installed Node dependencies and local Python 3.13. Create an isolated environment and install the pinned versions, then run the script:

```powershell
py -3.13 -m venv docs/evidence/private/rapidocr-venv
docs/evidence/private/rapidocr-venv/Scripts/python.exe -m pip install rapidocr==3.10.0 onnxruntime==1.31.0
npm run ocr:evaluate:rapidocr
```

The first inference downloads model files into the local environment. To use a different environment, set `NUTRISCAN_RAPIDOCR_PYTHON` to its Python executable. The aggregate output is written to ignored/private-safe `docs/evidence/rapidocr-evaluation.json`; it includes counts and timing, not text or images. The environment, model weights, photos, and screenshots are not committed.

Run the Chrome WASM threshold/gap sweep after installing the Python environment above:

```powershell
npm run ocr:evaluate:rapidocr:web
```

It requires Chrome and the same ignored local PP-OCRv6 weight files. Tiny results, including the connected-component mode, are in `docs/evidence/rapidocr-browser-runtime-sweep.json`; set `$env:NUTRISCAN_RAPIDOCR_MODEL_TYPE='small'` before running to produce `docs/evidence/rapidocr-browser-runtime-small-sweep.json`. The earlier baseline receipt remains `docs/evidence/rapidocr-browser-runtime.json`.

For the five-photo full-frame evaluation, use:

```powershell
$env:NUTRISCAN_RAPIDOCR_BROWSER_SCOPE='full-photo'
npm run ocr:evaluate:rapidocr:web
```

This writes only field-match counts and timing to `docs/evidence/rapidocr-browser-full-photo-evaluation.json`.

## Decision and next tests

Keep Tesseract.js as the product's local OCR reader for now. Keep every OCR string as an observation that requires user review; do not promote parser output into verified nutrition facts. RapidOCR is a credible offline alternative worth further investigation, but this five-photo run is too small and too slow to justify shipping a Python/ONNX runtime or adding roughly 32 MB of model assets to browser users. Current measured output still omitted or withheld 30 of 37 fields, while other languages and the multicolumn oats label remained unresolved.

Keep the shipping reader on the existing client-side Tesseract.js path for now; retain the PP-OCRv6 browser work as a local diagnostic. Connected-component extraction raised full-photo browser tiny from 3/37 to 6/37, all on one selected Indian oats photo; it raised both models to 6/17 on guided crops but yielded no Bagrry's matches. The larger small model matched the same crop score at five times the model weight. Before integrating a second reader, implement faithful detector post-processing, improve Bagrry's basis/column alignment without guessing, evaluate more independently annotated English and non-English labels, measure cold-download and actual mid-range phone costs, and preserve explicit model attribution. PP-OCRv6 model choices and redistribution terms must be checked against the [RapidOCR model list](https://rapidai.github.io/RapidOCRDocs/main/en/model_list/) and [model license and attribution statement](https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/); the browser execution route is documented by [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/). A commercial or remote vision service is not enabled: it would require a disclosed image transfer, server-side controls, a cost bound and explicit owner authorization. No API calls were made for this comparison.

## Limits

- Five selected images are a small convenience sample, not a held-out set or a population accuracy estimate.
- Expected values represent package observations, not verified product identity, formulation, or health advice.
- “Correct” means the parser emitted the annotated nutrient and declared basis within a 0.5% tolerance (minimum 0.015 in normalized units). This does not validate other fields.
- Omitted and withheld are reported separately because missing OCR is not a zero and an ambiguous basis must not be guessed.
- Timing varies with machine load, image dimensions and model initialization.
## Product-name candidate probe

RapidOCR PP-OCRv6 small was run locally on all five hash-verified package photos used for the mixed name-retention check. It detected the expected brand token in one image: the Nutella front jar view, with a 0.95952 line confidence. It did not detect the expected brand in the Coca-Cola or Heinz front photos or the Saffola and Bagrry's nutrition panels. Tiny, despite having roughly 6.32 MB rather than 31 MB of detector/recognizer weights, did not match the expected brand on any of the five photos. These CPU results are retained in `docs/evidence/rapidocr-name-retention.json` and reproduce with `npm run ocr:evaluate:rapidocr:names`.

I then tested the browser-compatible PP-OCRv6 paths in Chrome using ONNX Runtime Web WASM, with local assets on an ephemeral loopback server. Tiny detected Heinz in one of the five photos in both the baseline row-band and connected-component modes, at 0.9961 and 0.9909 line confidence. The other four photos had no expected brand match. Its detector/recognizer weights total 6.32 MB; the JavaScript and WASM runtime add about 14.7 MB. The model loaded in 365 ms on this desktop; detector calls ranged from about 0.3 to 1.35 seconds, and recognition took up to about 2.24 seconds on the two nutrition panels. Small also found Heinz once at 0.9999, but detector time reached about 12.5 seconds and row recognition about 11.5 seconds on the Saffola image. The small and tiny browser receipts are `docs/evidence/rapidocr-browser-name-retention-small.json` and `docs/evidence/rapidocr-browser-name-retention-tiny.json`.

The CPU and browser tiny runs disagree on brand recognition, and browser small/tiny only succeeded on the Heinz photo. This is a promising local browser experiment, not product acceptance: the browser detector still uses threshold and heatmap approximations rather than the full PP-OCRv6 DB contour post-processor, the sample is curated, and no phone latency or memory check has been made. Keep both models diagnostic-only until broader photo and real-device evaluation supports integration. In PowerShell, reproduce the tiny browser run with `$env:NUTRISCAN_RAPIDOCR_BROWSER_SCOPE='name-photos'; $env:NUTRISCAN_RAPIDOCR_MODEL_TYPE='tiny'; npm run ocr:evaluate:rapidocr:web`; substitute `small` to run the larger model.
