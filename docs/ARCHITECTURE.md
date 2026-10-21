# Architecture

See [architecture decisions](ARCHITECTURE_DECISIONS.md) for tradeoffs and boundaries.

```mermaid
flowchart LR
  Photo[Variable browser image collection] --> OCR[Local Tesseract worker]
  OCR --> Parser[Typed observations and parser]
  Text[Entered label] --> Parser
  Parser --> Engine[Deterministic portion and evidence engine]
  Corpus[Versioned sources and exact codes] --> Engine
  Engine --> UI[Audit, evidence ledger, follow-ups]
  UI -->|explicit query| API[Local bounded API]
  API --> OFF[Open Food Facts]
  API --> Science[Europe PMC and official sources]
  API --> Embeddings[Local MiniLM hybrid retrieval]
  API -->|key plus enable plus consent| Gemini[Gemini structured synthesis]
  Gemini -->|image handle request| Photo
  Photo -->|visible user send action| Vision[Gemini vision route]
  Vision --> Reconcile[Preserve observation conflicts]
  Reconcile --> UI
```

`src/lib/contracts.ts` is the single shared schema source. The contributor-owned technical boundaries now live in `src/modules/ocr/`, `src/modules/knowledge/`, and `src/modules/inference/`, each with a narrow public entry point. `src/lib/` retains owner-controlled compatibility facades and integration: browser history/profile storage and barcode composition stay in `browser.ts`; the application injects the Knowledge additive resolver into OCR; local Node embedding retrieval is exposed through the Knowledge `server.ts` entry; and Gemini SDK calls, consent, image inspection, external HTTP policy, routes, session state and UI stay application-owned. The modules do not import each other's internals. `profileSchema` contains only optional, separately declared context and starts empty. Existing tests exercise these boundaries in the repository; the modules are not separately published packages.
