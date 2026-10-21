# Offline OCR annotation adjudication

Use this workflow only after two people have independently annotated the same original package photograph. Each single-reader pass must remain blind to OCR output, product databases, arithmetic, and the other pass until both exports are complete. The command-line adjudicator processes JSON files only. The browser review tool opens the original image and both passes locally in the current tab; it makes no server upload, storage write, or provider call.

## Browser review

Open `/research/ocr-adjudication` in the local NutriScan app. Load both completed pass JSON files and the exact original image. The page compares their image SHA-256, dimensions and byte length before enabling export. It displays both readers' annotation regions over the image, but it never proposes field matches automatically. Add one explicit decision for each field, select each source field at most once, record the rationale and export the validated one-record dataset. Ambiguous or not-visible decisions keep printed digits, normalized values, operators, units and basis fields null. The exported record preserves pass-file hashes and field/region lineage without storing source filenames or image bytes.

The page is an offline interface to the same `adjudicateOcrAnnotationPasses` builder and shared schemas used by the CLI. Its synthetic browser acceptance checks the interaction and lineage contract only; it is not evidence that any real photo has been independently annotated.

## Run an adjudication

Create a decisions JSON file that links every field from both passes exactly once. Pair fields by their visible nutrient row, never by array position alone. A decision can select reader A, select reader B, enter a manually adjudicated field, or retain the result as `ambiguous` or `not-visible`. Each decision needs a short rationale. The source-reader IDs preserve disagreements for later audit.

For example, this decision explicitly pairs two independently named energy fields and selects reader A after reviewing the image:

```json
{
  "fieldId": "energy-per-100g",
  "disposition": "reader-a",
  "readerAFieldId": "a-energy",
  "readerBFieldId": "b-energy",
  "field": null,
  "regionSource": "reader-a",
  "rationale": "The printed digits and column are clear on direct review."
}
```

An `ambiguous` or `not-visible` decision must supply a field with `printedNumericText`, `numericValue`, `numericOperator`, `unit`, `basis`, and `basisText` all set to `null`. This prevents a disputed reading from becoming a numeric reference value. For a `manual` decision, enter the final visually adjudicated field and choose `regionSource` (`reader-a` or `reader-b`) for its region IDs. Do not use `manual` for an unresolved row.

The complete input follows `data/ocr-adjudication.schema.json`. It includes `schemaVersion: 1`, a dataset version, a pseudonymous adjudicator code, an ISO timestamp, a method description, and a `decisions` array. Then run:

```powershell
npx tsx scripts/adjudicate-ocr-annotation-passes.mts <reader-a.json> <reader-b.json> <decisions.json> > adjudicated-dataset.json
```

The command validates exact image identity, image size, product group, split, source/license metadata and language. It hashes the original pass files byte-for-byte, requires distinct reader codes and pass hashes, rejects reused or unmapped source fields, remaps both readers' region IDs without collision, and emits one strict dataset record. Keep the inputs and output local unless redistribution terms and image-specific rights have been reviewed. The output has source-pass hashes, field-level source links and rationale, region-ID mappings, an inter-reader score, and field-linked region-overlap measurements. It contains no image bytes, filenames or local paths.

The stored `agreementMetric` is the unweighted mean of seven exact field-dimension comparisons—label/key, printed number text, normalized number/operator, unit, basis, column and status—over only explicitly paired rows. Region alignment is reported separately for paired label, value, row, unit and basis rectangles as bounding-box IoU, with pair counts and the fraction at or above 0.5. These are descriptive annotation-agreement measures, not OCR accuracy, calibrated confidence, or proof that a reference is correct.

Every field from both passes must appear once in the decision map. If a field is visible in one pass only, pair it with a null from the other pass and record the explicit decision. The tool refuses a human-verified record if there is no paired field from which to calculate an agreement metric. A clear final field also needs references to the source label, value, row and basis regions, plus a column and basis text. Ambiguous and not-visible fields remain represented with null numeric content.

The command emits a one-record dataset. Combine records only when they share the declared dataset version and preserve product-group split boundaries. Assign and lock held-out product groups before any OCR engine or parser is tuned against them. Never count an adjudication test fixture as an annotated product or benchmark result.
