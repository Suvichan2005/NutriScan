# Semester research inputs requested

Status: preparation only. No new images acquired, human annotations, model responses, ratings or final results exist in this package. All package facts, rights checks, independent references and experiment freeze remain pending. Expected-answer obligations here and in the manifests are evaluation-only and must never enter production prompts.

## Owner action 1: 12–18 unfamiliar product groups

Nominate 12–18 genuinely unfamiliar groups with varied table layouts: snacks/crackers, noodles, dairy drinks, beverages, cereals and staples; include per-100-g/per-100-ml/per-serving and multicolumn panels, small text, glare/curvature and English/Hindi where genuinely present. This is a practical convenience sample, not a population-representative claim. Do not count variants, crops or repeated photographs as independent products. Record previous developer/model exposure honestly and permanently allocate exposed families to development. Do not reuse the three familiar conversation products as held-out proof.

For each group provide private local original photos of front identity/variant, all nutrition columns and units/bases, ingredients, allergens/precautions, serving/net quantity and relevant claims; overlapping close-ups are useful but retain whole-panel originals. Avoid people or personal information. Record productGroupId/family, exact variant and packaging revision, private paths, SHA-256, capture provenance/date, photo rights/permission, dimensions, exposure history and proposed split. Do not commit source images. A human custodian should review rights, readable coverage and family overlap, then lock development/calibration/held-out assignments before model tuning or final runs. Developers must not inspect held-out pixels or labels to tune extraction. Report unreadable/missing regions rather than silently selecting only easy products. Existing candidate intake is a discovery aid and does not prove unfamiliarity or independent references.

## Owner action 2: two independent readers and an adjudicator

Assign reader A, reader B and a human adjudicator using pseudonymous codes. Each reader independently inspects original pixels without OCR/model output, catalog nutrient values, arithmetic prefill or the other pass. Use the existing /research/ocr-annotation route and data/ocr-annotation-pass.schema.json for nutrition; data/evaluation/package-text-pass.schema.json separately records identity, literal ingredients/order/percentages, allergen declaration versus precaution, additives, claims and serving text. Preserve exact numbers, units, qualifiers, bases, row/column associations and normalized region polygons. Missing is not zero; preserve conflicting columns/readings. Do not infer a common ingredient or an unreadable digit.

Keep both immutable passes and hashes. Use src/modules/ocr/annotation.ts comparison/adjudication functions for nutrition; have the adjudicator review disagreements against pixels and retain decisions/reasons and unresolved uncertainty. Supplementary text also needs explicit human reconciliation. Confirm family allocation and rights independently before marking references final. Independent labels cannot be supplied by Codex or another model. Use scripts/evaluation/score-reconstruction.mts with the existing contracts and scorer; do not introduce a competing nutrient scorer. Ingredient/text correctness needs separate evidence-linked human review.

## Owner action 3: exact conversation package snapshots

Supply or confirm the actual Maggi Masala Noodles, Bisk Farm Cream Cracker (Sugar Free), and **Amul Rose Lassi** packaging revision and human-reviewed facts. Link each value to original observations/reference regions, preserve conflicts and correction provenance, and freeze one snapshot per product reused across its three profiles. The current public India candidate metadata lists Amul Taaza milk; that is not Rose Lassi evidence. No Rose Lassi identity or composition has been confirmed by this preparation. Do not substitute milk or infer bottle volume, sugars, calcium or sodium. If the available container differs from the owner's word “bottle”, retain the exact questions and document the mismatch for owner review.

Confirm cracker piece/weight/count relationships and sleeve quantity, noodle packet net amount and whether sodium component allocation is actually printed, lassi bottle volume/basis and total versus added sugar declarations. Unknowns stay unknown. For B-H and A-H preserve the scripted unreadable-sodium context even if a private reference can read it: predeclare the user-visible context and judge against that context; do not leak hidden reference values. A-H's chaas, earlier chai/achar/dinner, vegetables and paneer have no measured composition unless explicitly supplied. No invented individual targets or medication/lab details.

## Portfolio and paired study

semester-conversations.json contains the nine exact owner-authored conversations (M-D, M-H, M-DH, B-D, B-H, B-DH, A-D, A-H, A-DH), three turns each, with review obligations, unknowns, critical failures and continuity. Only D/H/DH diagnoses are fictional profile inputs; other assumptions remain identical. Vegetarian suggestions are a constraint for these tests only. Run each conversation in isolation using one selected conversational pipeline and frozen reviewed package context, without re-extracting photos per turn/profile. Preserve actual responses, source/tool receipts, failures, latency, token counts and generation rounds.

semester-experiments.json specifies five Gemini reconstruction arms: A Tesseract text, B Paddle text, C images, D Tesseract plus images, E Paddle plus images. All invoke the same frozen Gemini model/configuration/schema. Text-only Gemini requests contain no pixels, other OCR engine output, human corrections or hidden visual descriptions; local OCR necessarily reads the images. No hidden recovery. Record any later recovery separately. Request/transport receipts must establish isolation; a manifest alone cannot.

The practical knowledge contribution test uses nine initial questions, each paired with identical frozen initial context: package-only versus relevant knowledge tools. Keep model/configuration/base prompt fixed and archive both tool configurations and source snapshots. Reuse an exactly matching knowledge-enabled portfolio response where possible. This avoids a 27-turn × five-method × database factorial. Freeze budget and case subset before execution; if combined arms use fewer products, disclose separate paired denominators.

Existing run_experiments.py and experiment-plan.json reflect earlier modality arms. The new manifests deliberately do not edit them or claim executable adapter integration. The owner integrator must bind the five input-isolating adapters and freeze hashes to the existing gates before final execution.

## Human response review sheet (blank; duplicate for each turn/response/reviewer)

Blind response ID: ______  Conversation/turn: ______  Context hash: ______  Response hash: ______
Reviewer code: ______  Date: ______  Provenance: independent-human / pending

| Dimension | Score 0–4 or N/A | Evidence pointer / reason |
|---|---|---|
| Factual correctness | | |
| Package evidence correctness | | |
| Condition relevance | | |
| Source applicability | | |
| Helpful uncertainty handling | | |
| Numerical correctness | | |
| Practical usefulness | | |
| Naturalness/readability | | |
| Multi-turn consistency | | |

0 = incorrect/unusable; 1 = major problems; 2 = mixed; 3 = mostly correct/useful; 4 = fully supported/useful. N/A requires a reason; pending remains blank/null and is never zero. A turn without calculations need not receive an invented numerical score. Review the complete context/history for continuity; randomize paired response order and hide arm identity where practical. Give both reviewers identical authorized evidence, including actual tool/source receipts for applicability review without revealing treatment labels unnecessarily.

Critical errors (claim + exact response span + contradicting evidence): ______
Unknowns handled/missed: ______  Useful conditional action: ______
Independent reviewer disagreement: ______
Adjudicator code/date/decision/reason: ______

Retain both original ratings. Critical unsupported medical/scientific claims, fabricated values/sources, wrong bases, and universal safe portions must be counted separately; smooth prose must not compensate. Do not label machine judgments as human. The full nine-dimension sheet is authoritative for this study; existing answer-scorer fields need a documented human mapping and do not cover all dimensions.

## Freeze return checklist

Return private image/reference manifests and hashes, exposure/family/split review, rights signoff, both readers and adjudication receipts, three verified package snapshots, selected model/version/config/schema/prompt/tool/source/implementation hashes, explicit input-access rules, budget and product subset, scoring/latency/cost definitions, blinded rating assignments and owner-approved freeze ID. Freeze before final execution; changes require a new version and comparability review. This preparation artifact does not execute providers or authorize unfrozen final experiments; existing bounded development permissions remain unchanged. Run the local validator to check structure and attachment fidelity; passing is preparation evidence only.


## Five-arm runner binding (preparation)

The existing `run_experiments.py` now accepts family `semester-reconstruction` from `data/evaluation/experiment-plan.json`. Arms A–E derive their method IDs and evidence selections from `data/evaluation/semester-experiments.json`; legacy exploratory families remain unchanged.

Final configuration must set `stage: initial-reconstruction`, `recoveryPolicy: disabled`, `answerSynthesis: false`, freeze the arm-definition file with role `arm-definitions`, and bind/hash each adapter. Each adapter's `inputSelection` must exactly contain the declared `analysisMethod` and `evidence` list. Common frozen model/configuration and existing rights, split, reference and source gates still apply. Final receipts additionally require `actualStage: initial-reconstruction`, integer `recoveryCalls: 0` and `answerGenerationCalls: 0`; changing modality/model/configuration or including recovery/synthesis makes a receipt noncomparable.

Contract verification: `python scripts/evaluation/test_run_experiments.py`. This exercises synthetic restrictions and receipt handling, never Gemini or reference accuracy. The production five-method dispatch is separately verified. The local-only adapter `scripts/evaluation/reconstruct-initial.mts` now invokes the same production reconstruction once, with no answer/recovery stage. It takes one JSON job on stdin and requires `--allow-provider`, local development and readable capture (`NUTRISCAN_GEMINI_EVAL_CAPTURE=1`). Declare exactly one hashed raw request JSON in `inputFiles` with role `reconstruction-input`, plus originals/other artifacts needed by the reference manifest. Raw requests must omit external evidence/profile/conversation/prior reconstruction; image methods accept full photos, not recovery crops. The adapter applies selected-method filtering, verifies the raw file hash, returns actual model/tier/configuration/usage/routes, and preserves full readable output in the existing private recorder. Example argv: `["npx","tsx","scripts/evaluation/reconstruct-initial.mts","--allow-provider"]`. These are provider-capable commands; prepare/freeze alone makes no calls. Frozen configuration and independently reviewed references remain required before final study execution. Do not run the full consumer answer route and label it initial extraction.
