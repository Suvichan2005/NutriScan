# Local barcode evaluation

Updated: 2026-10-21.

## Implementation and measured checks

Barcode intake first uses the browser's native `BarcodeDetector` when present. When that API is missing, unsupported, returns no valid retail code or throws, NutriScan lazily loads `@zxing/browser` and `@zxing/library` and attempts EAN-13, EAN-8 and UPC-A decoding from a locally resized image. The bitmap and temporary canvas are released after the attempt. GTIN check digits are validated before a value can set a product lookup. Decoding failure leaves the OCR flow available.

`npm run typecheck` and the full Vitest suite pass. The suite covers native detection, format filtering, invalid GTIN rejection, fallback invocation, deduplication and non-fatal failure handling.

`npx tsx scripts/evaluate-barcode-fallback.mts` runs an actual Chrome browser test with the browser's native `BarcodeDetector` absent. It generates an EAN-13 test image in the browser and passes its PNG through the production `detectRetailBarcodes` function. Observed result: expected `4006381333931`; detected `4006381333931`. This isolates the software decoder and does not establish performance on package photographs.

Three initial local Chrome package-photo runs were inconclusive for barcode accuracy: a Heinz front photograph, a Coca-Cola nutrition photograph and a French-language Nutella nutrition photograph did not produce a barcode lookup. A separate fresh production build with the fallback enabled was then exercised in Chrome at 390×844 and 1440×900 using the Heinz front photograph; its responsive intake guidance was visible at both sizes, and scanning continued to a result with no barcode lookup. Visual inspection confirms that Heinz image is a front-only package shot without a barcode, and the other two images are nutrition panels. They are not valid negative barcode cases. OCR remained available in the fresh-build run.

## Limits and next evidence

No real package photograph with a visible, sufficiently large barcode was available in this local evaluation set. Real-photo decoding, camera capture, perspective/glare recovery and low-resolution performance remain unverified. The production build completed using Webpack in an isolated copy; Turbopack could not resolve the temporary external `node_modules` junction and was not changed. `npm audit` reported zero vulnerabilities. Obtain a genuine package image with a clearly visible barcode and the matching printed GTIN for the next real-photo acceptance run. A decoded GTIN is an identifier candidate; it does not prove market, formulation or package identity.

Reproduce the synthetic browser check with `npx tsx scripts/evaluate-barcode-fallback.mts`. Reproduce the manifest-backed local UI probe, when a suitable photograph is provisioned, with `npx tsx scripts/evaluate-barcode-browser.mts <manifest-file>`.
