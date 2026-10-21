# Inference module contributor rules — Yash

## Ownership

You may edit only `src/modules/inference/**`. The owner controls every other path, including `src/lib/contracts.ts`, compatibility adapters in `src/lib/`, `src/app/api/**`, `src/components/**`, application state, configuration, package scripts and other module roots. If integration needs a change outside this directory, explain the exact interface change in your pull request; do not make it yourself.

## Module purpose and boundary

This module prepares bounded evidence context and validates/renders a structured inference response. The stable public entry point is `index.ts`.

- `AssistValidationContext` accepts a package record, attributed evidence sources, deterministic calculations, optional user-declared profile fields and optional browser image handles.
- `assistOutput` is the module's structured response schema. It reuses owner-controlled schemas from `src/lib/contracts.ts`.
- `validateInferenceOutput` checks citation identifiers and exact evidence spans, validates OCR word references for tentative candidates, filters unsupported output and renders only validated claims.
- `assistEvidenceContext` and `packageForAssist` prepare bounded evidence and preserve raw OCR observations when removing duplicate text.
- `InferenceModuleError` is provider- and transport-independent. The application adapter maps it to its HTTP error type.

The Gemini SDK adapter, API routes, consent controls, image inspection, session lifecycle, local deterministic audit engine and user interface remain application-owned. Do not add provider enablement or perform remote calls in module tests.

## Stable dependencies and invariants

- Reuse schemas and types from `src/lib/contracts.ts`; never copy their definitions into this module.
- Do not import UI state, Next.js, API routes, `src/lib/server/http`, food-knowledge storage internals, OCR parser internals, Gemini SDKs or image-processing providers into the provider-independent core.
- Keep model interpretations separate from observed package facts. Tentative candidates must remain tentative and traceable; never mutate or confirm package observations.
- Missing data is not zero. Preserve conflicts, units, serving bases, user context and evidence provenance. Conversation history is context, not citeable evidence.
- Exact citation spans provide traceability, not semantic entailment. Do not describe this validation as proof that a claim is true or supported in meaning.
- Do not weaken input/output bounds or safety/privacy invariants to make a fixture pass.

## Tests and evaluation

Run the module-only offline suite from the repository root:

```powershell
node src/modules/inference/test.mjs
```

The runner invokes the installed Vitest directly and does not call a provider. Before proposing an integration change, also run:

```powershell
npm run typecheck
npm test -- src/modules/inference src/lib/__tests__/assist-evidence-contract.test.ts src/lib/__tests__/assist-evidence.test.ts src/lib/server/server.test.ts
```

Module tests must use synthetic fixture inputs. Do not require API keys, private package photos, personal health records, external services or network access. Keep mocked model output clearly separate from live-provider evidence. A passing fixture suite validates code paths and contracts only; it does not demonstrate Gemini accuracy or behavior.

## First independent work package

Add a small, general fixture set for evidence-grounded reasoning across noisy OCR, conflicting package observations, missing units/bases, retrieved-source limitations, deterministic calculations and explicitly supplied profile context. Measure which claims are retained, rejected or abstained and whether each retained claim points to the right evidence. Include counterexamples for unsupported associations and numerical contradictions. Do not add condition-specific canned answers, modify the provider prompt or enable Gemini as part of that work.

## Pull request expectations

- Changes stay inside `src/modules/inference/**` unless the owner has explicitly approved a specific integration edit.
- The module-only runner passes; changed behavior has meaningful offline fixtures.
- The public exports remain narrow, and the module has no circular or forbidden application/provider dependency.
- The PR states inputs, outputs, limits, evaluation evidence and any proposed owner-side integration separately.
- No credentials, private images, personal user data, provider receipts or claims of live model acceptance are included.
