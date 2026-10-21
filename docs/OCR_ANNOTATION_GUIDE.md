# Package-photo annotation guide

This guide defines the reference-label process for the shared OCR research contracts. A model output is never a reference label. The initial pilot remains unscored until its image regions and field values receive independent human review. The local-only annotation interface is `/research/ocr-annotation`; it exports one pass conforming to `data/ocr-annotation-pass.schema.json`. It does not perform OCR, upload images, store draft state, or include photo bytes in exports.

## Sampling and split lock

- Use real photographs of physical packaged-food labels. Record the source product page, exact source-image URL, uploader, retrieval date, image dimensions, byte length and SHA-256.
- Assign a stable `productGroupId` from the product family/GTIN. Keep all package revisions, markets, languages and crops for that family in one split.
- Put photos used to choose thresholds, parser rules or preprocessing in `development`. Reserve separate product groups for `held-out` and freeze the manifest and hashes before running any candidate engine.
- A held-out designation means the engine team has not used that product to tune the pipeline. It does not by itself mean that its reference labels are human-verified.
- Keep the original image bytes in an ignored, access-controlled local directory. The tracked dataset contains metadata and annotations only.

## Blind annotation and adjudication

Two annotators independently transcribe each image before seeing OCR output or each other's work. They record visible nutrient labels, the exact printed numeric string, its normalized numeric value and qualifier, printed unit, column and serving basis. They separately draw table, row, label, value, unit and basis polygons in normalized image coordinates. Do not infer a value from product databases, nutrient arithmetic, a serving-size calculator or another product variant. Use distinct anonymous reader codes; keep both exported JSON passes private until both readers finish.

After independent passes, compare field-by-field agreement for label/key, literal numeric text, normalized numeric value and qualifier, unit, basis kind/amount/unit, column, and region placement. State each component's denominator and agreement formula. Adjudicate disagreements against the original source pixels. Preserve unresolved or unreadable fields as `ambiguous` or `not-visible`; never replace them with zero. Record the agreement method and result, annotator count, adjudication state and reference status in the dataset. `human-verified` is reserved for human-reviewed annotations. Model-assisted transcription is useful for exploration but is not a gold standard.

For a first comparison, run `npm run ocr:compare-annotations -- <reader-a.json> <reader-b.json>`. It validates that the passes are from distinct readers and the same image hash, then prints dimension-level exact agreement and region bounding-box IoU to stdout. Nutrient rows pair by array order, so both readers must annotate top-to-bottom; check key differences and unpaired rows manually. The comparator does not merge passes, choose an adjudicated value, set `human-verified`, or write an output file. Review all mismatches against the original image before creating a dataset record.

Annotate the exact printed column and unit. A `per package` value is not converted to a mass basis unless that mass is printed on the same package. Preserve qualifiers such as `<1 g` with a numeric operator; do not round a printed decimal to create an exact match. Record a serving basis as its kind and known amount/unit. If the amount is absent or unclear, do not infer it.

## Geometry and stage evidence

Polygons use normalized `[x,y]` coordinates in the orientation and dimensions of the original image bytes. Include a table polygon, row polygons and separate label/value/unit/basis polygons where visible. Region IDs are stable within one image. Each nutrient annotation links to its label, value, row and basis regions and to a column ID. Record `unit: null` and no unit polygon when the printed row has no separate unit; do not infer one from convention. If a unit is printed, transcribe it and link its visible region.

Text-region detection is measurable only when the target region is annotated. The current scorer reports a detected-region match when a predicted OCR region covers at least 50% of the reference polygon's bounding-box area. Label recognition is case-insensitive normalized text agreement within the annotated label region. Numeric, unit and basis results are scored separately. Row/column association requires the emitted candidate's source region to overlap the annotated row and value region in the expected column. Parser acceptance/rejection is recorded separately with a bounded rejection code. If required annotations or engine evidence are absent, report that stage as unavailable (`null`) rather than infer a cause from the final nutrient score.

The 50% reference-area threshold is a predeclared pilot rule, not a universal OCR standard. Keep it fixed for a held-out run and include it in the experiment version. A later threshold change is a new development experiment.

## Reference and license provenance

For Open Food Facts, cite the product page and exact image URL and retain the uploader attribution. Its official guidance distinguishes the database (ODbL), individual contents (DbCL) and product photographs (CC BY-SA). The image may also contain packaging artwork, trademarks or other third-party material. Record the license review as pending until image-specific reuse has been checked; do not commit source photographs to this repository. See the [Open Food Facts license guidance](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/).

For every OCR engine, model and runtime, record exact versions, model artifact URLs and hashes, and license provenance. Record server/container costs as dated assumptions with a source, not as a measured cost unless usage was actually billed or metered. Do not make provider calls without separate owner authorization.
