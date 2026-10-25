# India-first package evaluation collection

This is evaluation preparation. No annotation, held-out accuracy or independent ground truth is claimed. It uses the existing nutrition annotation/adjudication workflow and an evaluation-only supplement for other package text. Production perception, Gemini prompts, tools and shared contracts are untouched.

## Actual intake and limits

The current intake has **38 real Open Food Facts India-tagged product records** in eight discovery strata: noodles 5, snacks 5, biscuits 5, cereals 5, dairy 5, beverages 5, flour/staples 5 and pulses 3. These are a convenience sample from eight bounded official Search-a-licious queries, with at most 25 hits queried per stratum; no universal Indian-market representativeness is implied. Dairy uses the explicit `en:milks` category to avoid counting milk biscuits as dairy. Actual category, Indian formulation, printed language, legibility and layout still need human review. `lc`, country tags and selected-image language suffixes are source metadata, not verified text language.

`data/evaluation/india-collection.json` retains 103 original-image references, image IDs/revisions, public uploader attribution where available, dimensions from source metadata, dates, product grouping and rights status. Numeric OFF codes are grouping identifiers; no independent GS1 authentication is claimed. Metadata snapshots remain in ignored `.data/evaluation-preparation/raw-searches/`; their hashes are checked by offline validation. The original numeric source-photo IDs are used, rather than silently treating a selected crop as an original photograph.

**New candidate photos have not been acquired.** Python's normal HTTPS verification of `images.openfoodfacts.org` fails with `certificate has expired`. The downloader stopped after repeated shared-host failures. TLS verification remains enabled. Each candidate image explicitly retains the acquisition failure, a null hash/path and a blocked readiness state. This is a source-access dependency, not 103 collected photographs.

There is a separate immediately usable development batch of **eight existing original photos across five groups**: Bisk Farm, Bagrry's, Saffola, Maggi and Amul. Six hashes match existing source receipts; the two owner-supplied Bisk files have new current-file hash baselines, without a claim of matching an earlier pinned receipt. Header dimensions and lengths were checked; no fresh visual inspection, OCR or model inference was used. These groups are permanently development-exposed and do not establish unfamiliar-product performance.

## Splits and rights

The 38 new candidates have a deterministic **proposal** of 14 development, 6 calibration and 18 prospective held-out groups. The fixed `nutriscan-india-split-v2` hash ranking allocates unexposed family IDs approximately 30% / 20% / 50%; known development-exposed families are forced to development. Every group and crop stays together. Family IDs initially come from normalized product names and therefore require human merging of related GTINs, pack sizes, variants and regional revisions. Review category balance after those merges. These splits are unlocked; do not run final testing on them or describe the proposal as a frozen benchmark.

The existing nutrition-pass schema has `development`, `held-out` and `not-assigned` only. Use `not-assigned` for proposed calibration/held-out annotation passes until the owner-controlled freeze; keep the proposed role in the separate batch manifest. Never change production schemas merely to add a research role.

OFF database, individual-content and contributor-image licensing are distinct. Record the official guidance linked in every source record; preserve attribution. Embedded artwork/trademark rights and image-specific reuse are pending review. All original images, metadata snapshots, passes and adjudication files remain private/local. Do not commit or redistribute them. A database country tag or public image URL is not redistribution permission.

Freeze requires: source/photo hashes; rights and market/language review; completed family grouping; development-exposure audit; two blind human passes plus adjudication; pinned model/prompt/tool/source versions and methods. Until then, final experiment execution is blocked, not scored as zero.

## Reproducible commands

From the repository root, Python 3 with Pillow is needed for header dimensions; the self-test also uses `jsonschema` (both are available in the current environment).

```powershell
# Initial bounded metadata acquisition; subsequent calls replay the saved caches.
python scripts/evaluation/prepare_collection.py acquire

# Offline only: validates metadata caches, product/family boundaries and saved photo hashes.
python scripts/evaluation/prepare_collection.py validate
python scripts/evaluation/prepare_collection.py self-test

# Offline only: creates the blind new-candidate batch manifests.
python scripts/evaluation/prepare_collection.py prepare

# Offline only: checks existing development originals against their source receipts.
python scripts/evaluation/prepare_collection.py prepare-existing
```

`acquire` refuses to replace a locked or annotated collection and preserves existing acquisition state on cached replay. It cannot create human labels. `download` is the explicit original-photo acquisition command, capped at 70 MB total and 4 MB per photo, with a three-certificate-failure stop. Do not retry it until normal verified HTTPS access is available; do not disable certificate checks. It does not run OCR or inspect image content.

## First actionable human batch

Open the private manifest:

`.data/evaluation-preparation/annotation-batches/existing-development-01.json`

It contains eight tasks, exact original paths, hashes, dimensions, lineage and source-license status. Assign two distinct anonymous readers (`reader-a`, `reader-b`) and a later adjudicator. Keep their exported pass directories separate. For each task:

1. Open `/research/ocr-annotation` in the already-running local app and load the exact original file from `privateLocalFile`. Enter its prepared image/group ID, development role and source metadata.
2. Read the pixels independently, without OFF nutrient/ingredient records, previous OCR, model output, arithmetic, online product lookups or the other reader's pass. Annotate every legible printed nutrient, numeric string, unit, qualifier, original column/basis and relevant regions. Missing is not zero. Leave uncertain digits unresolved. See `docs/OCR_ANNOTATION_GUIDE.md`.
3. Export the existing nutrition-pass format to a private `reader-a` or `reader-b` directory. Do not call a single-reader export `human-verified`.
4. Separately record identity, ordered ingredients, exact percentages, allergens, precautions, additive identifiers, warnings, claims, serving declarations and other text under `data/evaluation/package-text-pass.schema.json`. This supplement uses normalized original-image polygons, exact literal text, explicit section coverage and a `single-reader-unadjudicated` status. Transcribe ingredient mass percentages separately from nutrient composition. No model-prefilled values are supplied.
5. After both readers finish, compare nutrition passes and adjudicate against the original pixels using the existing tools:

```powershell
npm run ocr:compare-annotations -- reader-a.json reader-b.json
npx tsx scripts/adjudicate-ocr-annotation-passes.mts reader-a.json reader-b.json decisions.json > adjudicated-dataset.json
```

Use `/research/ocr-adjudication` when visual region review is needed. For the package-text supplement, explicitly align items by image/section/order, preserve both original passes and hashes, and record adjudicator decisions and rationale; do not silently merge text or infer an allergen/claim. The current supplement defines the pass contract, **not an implemented general supplement adjudicator**. Keep that human/adjudication result separate until reviewed by the integration owner.

The nine new-candidate batches listed in `data/evaluation/annotation-batches.json` are already split by proposed role, but their image tasks are blocked on source acquisition and cannot be annotated from metadata. Reader-facing manifests exclude nutrition/ingredient records and model output. Existing source records stay in a separate private directory.

## Verification and remaining dependencies

Executed: cached replay, all 38 product/family/market-tag metadata checks, image-source bounds, private-source hash checks for the eight existing originals, schema compilation, valid structural fixture acceptance, and negative checks for exposed held-out leakage, family split leakage, model-generated references, false human-verified status, malformed hashes and a clear text item without source-region evidence. Structural fixtures are not saved as human annotations or accuracy evidence.

Remaining: normal verified image-host HTTPS access; image-specific rights and formulation review; human family/stratum review; two independent readers/adjudication; locked references and experiment configurations. No provider budget was used. Layout, multilingual readiness, field accuracy and source applicability remain unmeasured for the new collection.
