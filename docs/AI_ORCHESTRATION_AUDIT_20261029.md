# AI orchestration audit and targeted refinement

## Decision

Keep the current natural Gemini architecture and ordinary tool profile. The core six-part instruction is already concise and mostly coherent. The application separates reconstruction, natural conversation, deterministic execution and UI presentation; replacing it with another agent layer would add risk without evidence of benefit. Fix four demonstrated shared-boundary defects and remove duplicated tool instructions. A larger prompt rewrite was tested and rejected because it did not reliably improve source use or clinical restraint.

This is a bounded development audit, not an OCR/model benchmark, formal study or report revision. Private baseline source copies, exact prompt/tool exports, requests, responses, replay results and usage remain under `.data/orchestration-audit-20261029/`. The initial source baseline is `53d39b8d0c91294cbc9f0785faabb6e8613661b9`. Protected owner overlays and report artifacts were preserved.

## Production flow inspected

1. `assistInput` requires explicit consent and validates package, profile, bounded history, evidence, image and capability inputs. Requested models and paid fallback are server-checked. The browser separately decides whether the optional profile is shared. A health question can itself disclose context; omitting the profile does not make cloud chat private.
2. The selected analysis method constrains photo/OCR inputs. Initial reconstruction uses its own system instruction, forced typed submit operation and validated schema. Ordinary conversation does not receive that operation or replay photo bytes. Bounded photo inspection uses already attached images only.
3. Canonical reconstruction, corrections and revision state feed compact package context. Superseded rows are excluded. OCR word geometry is omitted once a current reconstruction exists; relevant original evidence remains in storage. Stable fact IDs avoid duplicating reconstructed prose.
4. Bounded prior user/assistant turns provide continuity. Historical calculations require current package provenance and correction compatibility. Old answers are not numeric authority. Cited history is distinct from new retrieval and subject to continuity/scope checks.
5. An explicitly shared health profile can cause a small local guidance preload. This is automatic evidence provision, not a model-selected tool call. Research subsets disabling guidance also disable that injection. The model then chooses among the exposed native tools.
6. Native requests are allowlisted, Zod-validated, cached per turn, executed with bounded rounds/calls/time and returned with source/calculation handles. Five tool rounds, twelve executions and a 110-second agent budget are retained. Specialized tools and controlled local research subsets remain explicit capabilities; there is no new lexical intent router.
7. Returned evidence is accumulated, answer-cited records are prioritized, missing/off-topic historical references are filtered, precise quantities/bases are checked and source handles become readable references. Source cards are selected from citations rather than every search hit. Final calculations and source records stay distinct from answer prose.
8. The existing React answer, source cards, inline activity, portion controls, clarification, corrections and persistence remain unchanged. Opt-in local diagnostic capture and metadata-only operational logging were not widened.

## Actual tool inventory

There are 21 declarations in the full catalog. Ordinary mode selects 13, or 12 without attached images. The reconstruction submit operation is separate. Tool names, schemas and exposure membership are unchanged.

| Tool | Exposure | Execution and evidence boundary |
|---|---|---|
| inspect_package_image | Ordinary, attached images only | Returns authorized original pixels/crop; no new photograph acquisition |
| calculate_nutrition | Ordinary | Local typed arithmetic and source-basis reconciliation; no missing weights or personal portion prescription |
| clarify_package_reading | Ordinary | Optional existing consistency issue; never blocks an open model request |
| resolve_ingredient | Ordinary | Observed identity and source-linked relationships; identity is not dose, presence, allergy safety or Indian permission |
| get_ingredient_concept | Ordinary | Exact local FoodOn concept, relations and paged properties |
| search_knowledge | Ordinary | Local MiniLM/BM25 candidates plus curated relationships and scope checks |
| get_nutrition_guidance | Ordinary | Focused local attributed summaries; authorized condition/jurisdiction context |
| search_guideline_documents | Ordinary | Search pinned local WHO PDF text; availability is reported |
| get_guideline_pages | Ordinary | Bounded original text-layer pages and attributed chunks; not application paraphrases |
| lookup_product | Ordinary | Public Open Food Facts query with authorized product identity; candidates are not package facts |
| get_product_record | Ordinary | Exact eligible GTIN and bounded original record fields; external catalog access |
| search_food_composition | Ordinary | Local USDA generic composition, not branded Indian package replacement |
| get_food_composition_record | Ordinary | Exact release/food ID and bounded original fields |
| lookup_chemical_identity | Specialized | Authorized PubChem identity request; no health/safety entailment |
| get_substance_assessments | Specialized | Local EFSA identity/assessment overview |
| get_assessment_records | Specialized | Exact local substance/section/record details; species, endpoint and exposure limits retained |
| search_jecfa | Specialized | WHO identity/evaluation discovery; external source access |
| get_jecfa_record | Specialized | Exact chemical/year and original assessment metadata; no package exposure inferred |
| get_codex_category | Specialized | Local hierarchy/ancestors/children; category taxonomy is not additive authorization |
| search_research | Specialized | Bounded authorized Europe PMC or fixed official regulation sources; no invented search expansion |
| get_research_record | Specialized | Exact publication and source metadata; returned publication is not automatic applicability |

All 13 ordinary tools are retained. Schema size alone is not evidence that a capability is harmful. A question classifier or another tool-selection model would undermine the current natural-agent design; two development questions do not justify pruning generally useful tools. Runtime checks remain stricter than provider JSON schemas where supported SDK schemas cannot express every invariant.

## Accepted changes

| Boundary | Before | After and reason |
|---|---|---|
| Source-format instruction | Every source record described as an application-prepared summary | Distinguishes application summaries, original excerpts and external records. Full WHO pages and original product/composition records made the old blanket instruction false. Other core policy is preserved. |
| Reconstruction tool text | Repeated much of the reconstruction system instruction | Short submit contract retains evidence IDs, coordinate grid and no fabricated digits; extraction policy stays in the existing reconstruction instruction/schema. No schema/modality change. |
| Guidance tool description | Repeated system clinical caveats and an unconditional-looking instruction to use guidance for explicit condition requests | Concise purpose, reuse of applicable evidence, authorized context, population/legal limitations and local-only execution. Core safety remains in the system and returned records. |
| Guidance execution | Without an explicit condition argument, discarded the model's focused query and ranked the whole authorized conversation | Honors the focused query. Explicitly invented conditions still cannot create personal context. User-requested source identity is carried separately from topic ranking, preserving source requests without polluting the query. |
| Automatic guidance topics | Reconstructed rows supplied display names only | Includes the existing canonical nutrient key. A plural printed label such as Carbohydrates previously missed the singular catalog topic; no product, condition or question-specific mapping was added. |
| Numeric context | Only question identifiers considered; authorized health labels omitted | Passes the already authorized profile to validation and recognizes exact numbered health labels. Profile goals do not become nutrient/portion authority. Unsupported amounts and changed identifiers remain rejected. |
| Numeric source serialization | Duplicated printedValue and typed value, detaching a comparator from its unit | Serializes one typed quantity with comparator. A printed less-than limit is usable as a limit, not an exact amount. Unknown qualifiers remain non-authoritative; original printed bases are retained. |

## Measured development evidence

The baseline was preserved before edits. Two previously exposed package-conversation inputs were identical within case across baseline, prompt-only, tool-only and combined variants. A second, broader prompt candidate was separately retained. Twelve matched development outcomes used 19 free Flash-Lite generations. These use native SDK function calls and production executors/serialization/validation helpers in a bounded comparison adapter, not a new production runner or browser acceptance.

The larger rewrite did not reliably improve scientific grounding. All six constrained-follow-up comparison responses lacked source attribution despite supplied evidence; several still prescribed the printed serving too firmly. It was not adopted. Portion queries selected the calculator across compared variants, but sample size is too small to establish general tool-selection accuracy. The accepted prompt-only change is the truthful source-format distinction.

Before/after replay uses the same twelve raw answers and tool outputs. Withheld sentences changed from 15 to 6; retained character counts changed from 7,196 to 8,790. This is not an accuracy score: a retained sentence can still contain an unsupported causal or safety inference. Explicit probes establish the important asymmetric correction: the real saved '< 0.5 g per 100 g' reading is retained, while false exact '0.5 g per 100 g' promotion changes from accepted to withheld. An unrelated unsupported '2 g sugar' remains withheld, and the supplied type-2 label survives. Negative unit, comparator, count and changed-identifier checks remain.

Direct guidance replay shows a focused free-sugars query previously returned nothing when the user said 'sweetness'; it now returns the applicable local record. The invented-CKD negative stays empty. Existing hypertension and dated Indian label-reference cases remain available; a future-effective amendment is not promoted to current compliance.

A final before/after check uses the actual production `assist()` operation, the same fictional profile, saved package and follow-up, and pinned free `gemini-3.5-flash-lite`:

| Observation | Before canonical topic binding | After |
|---|---|---|
| Supplied context | Free-sugars source only | IDF diabetes guidance plus free-sugars source |
| User-visible citation card in returned UI contract | None | IDF source card |
| New tool calls | 0 | 0 |
| Withheld quantity sentences | 2 | 0 |
| Input/output tokens | 6,760 / 256 | 6,994 / 218 |
| Total observed time | 4.292 s | 13.154 s |

This demonstrates better automatic evidence selection and actual answer attribution, not autonomous retrieval. The improved answer still said to stick firmly to the printed serving; scientific restraint is not solved. Single observations, caching, provider variation and the absence of a fixed production seed prevent causal latency/quality claims.

Across feasibility, comparison and two production checks: 22 free generations, 170,067 input tokens, 3,525 output tokens, zero paid calls and zero external-tool network attempts in the comparison adapter. Free-route ledger estimates are zero; no provider invoice claim is made. Ordinary schema bytes with images decrease from 13,026 to 12,754 (2.1%). The core instruction grows from 1,850 to 1,904 characters to correct source provenance. The reconstruction system instruction is unchanged. Adding an applicable source costs context tokens; this is justified relevance, not an overall token-saving claim.

## Safeguards and limitations retained

- MiniLM hybrid scoring remains 0.9 cosine plus 0.1 normalized BM25, with an exact-identity boost and a 0.4 development floor. The retained 24-query developer relevance result is not independent calibration. Neither raising nor lowering this floor is justified by this audit; downstream topical/jurisdiction checks also affect coverage.
- Source matching proves record identity, not claim entailment. Current-source and historical-source scope rules can still admit unsupported scientific associations or reject synonyms. No extra judge agent or lexical medical-answer gate was added.
- Ingredient/allergen identity relationships are not evidence of absence, cross-contact freedom, dose or individual safety. Generic USDA values cannot overwrite package readings. Dated FSSAI/Codex material is not current product-law verification; ordinary mode cannot silently invoke specialized current research.
- Automatic profile guidance can add context to a quantity-only question. It remains local, bounded, distinct from model retrieval and disabled for controlled knowledge-off subsets. No new question-word classifier was added merely to save a small amount of context.
- Tool-result evidence can be repeated in structured results and citation summaries. Blind deduplication could drop detailed records or original passage scope, so it was not bundled into this correction.
- Legacy lexical follow-up handling exists in the deterministic local fallback, including an old WHO/fibre age-follow-up rule. It is not used to rewrite the natural Gemini request; it was not expanded or mistaken for a semantic agent controller.
- Numerical guards still do not fully establish nutrient/ingredient/portion relationships. Valid compound basis wording can be withheld; wrong causal claims can survive. There is no claim of complete medical grounding or independent package accuracy.

## Verification and stop boundary

Final full offline suite: 956 passed, two skipped across 82 files; TypeScript validation passed. An initial unrestricted-worker run timed out in two existing PDF-discovery tests; the same file passed alone, and controlled four-worker full runs passed. No test file or timeout was weakened to obtain a pass. Tests establish contracts, not food/scientific accuracy.

The final source/correction/citation cases, native calls and returned source-card contracts were inspected. No UI change, new browser acceptance, fresh optimized build, new photo interpretation, OCR comparison, local-model benchmark or academic report update is claimed. This task ends at the reviewed checkpoint. Larger experiments and report edits remain separate owner missions.
