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

`src/lib/contracts.ts` is the shared schema. `parser.ts`, `engine.ts`, `knowledge.ts` and `reconcile.ts` are independent pure modules. `profileSchema` contains only optional, separately declared context and starts empty. `browser.ts` owns image attachments/OCR/IndexedDB. `semantic.ts` owns local Node inference and index validation. `server/` isolates external HTTP and provider calls. `app/api/` validates public entry points. The current UI remains in a single component with separate styling; future work can split panels without changing evidence contracts.
