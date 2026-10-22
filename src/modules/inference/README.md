# Inference module

This module owns bounded assist-evidence preparation and provider-independent validation/rendering of structured reasoning output. Its public interface is `index.ts`: `AssistValidationContext` supplies a package, attributed evidence, deterministic calculations and optional declared profile/image-handle context; `assistOutput` defines the structured response; `validateInferenceOutput` returns traceable claims and tentative package candidates without mutating package facts. Candidates may cite exact OCR spans or a photo attached to that same request. Image-based candidates retain the model-reported text and optional normalized region, are rendered as unverified visual interpretations, and cannot affect confirmed package facts or calculations. `assistEvidenceContext` and `packageForAssist` prepare evidence while preserving the richer ordered OCR observations.

The module reuses schemas from the owner-controlled `src/lib/contracts.ts`. The Gemini SDK adapter, API request/consent handling, image transfer, routes, UI and session state remain outside this directory and owner-controlled. A visual citation is valid only when matching image bytes were attached to the request; a local image handle alone is insufficient. Application compatibility adapters may import this module and map its typed errors, but module code must not depend on those adapters.

Arabic-numeral quantities in synthesized claims must match quantities in their exact cited spans, with basic mass, energy, volume and percentage unit equivalences normalized. Calculation-backed quantities still require a cited deterministic calculation. This catches digit/unit contradictions; it does not validate written-out number words, prove semantic entailment or establish provider accuracy.

Run the module-only offline fixture suite from the repository root:

```powershell
node src/modules/inference/test.mjs
```

The module is currently owner-controlled and has no teammate assignment. A suitable future package is a general fixture evaluation covering noisy OCR, conflicting observations, missing units/bases, retrieved-source limitations, deterministic calculations and explicitly supplied profile context. Report retained, rejected and abstained claims, citation traceability and numerical contradictions without adding condition-specific canned answers or enabling the provider.

The fixtures use synthetic inputs and mocked structured outputs. Passing them demonstrates validation behavior only; it does not establish Gemini accuracy, live-provider behavior or integration acceptance. A bounded free-tier Gemini 3.8 check on real package OCR text returned HTTP 503 without output; no image was attached and no extraction result was scored. Gemini remains disabled, and this module's tests make no provider calls.
