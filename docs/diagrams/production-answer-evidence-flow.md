# Production answer evidence flow

This diagram follows the natural conversational follow-up path in `src/lib/server/gemini.ts`. It distinguishes evidence availability and citation display from semantic proof of a scientific assertion.

```mermaid
flowchart TD
  Q[User question and active package] --> R[Local retrieval and agent tools]
  R --> T[Typed calculations and returned evidence records]
  T --> M[Natural language answer]
  T --> E[Effective evidence set: supplied plus tool-returned records]
  M --> S[Source-reference scope guard: availability, topic, guideline jurisdiction]
  E --> S
  Q --> S
  H[Recent user questions for clear contextual follow-ups] --> S
  S -->|eligible prose| V[Quantity and printed-basis validation]
  P[Current package observations and reconstruction] --> V
  C[Typed calculations] --> V
  S -->|unavailable, off-topic or out-of-scope citation| W[Withhold sentence and explain omission]
  V -->|unsupported numeric sentence| W
  V -->|accepted prose| I[Resolve source handles and identify named sources]
  E --> I
  I --> U[Answer text and source-reference cards]
  Q --> LA[Build local audit; resolve supported short follow-ups from prior user questions]
  P --> LA
  LA --> LR[Local reply preserves complete direct source-backed guidance or claim explanation]
  LA --> LE[Filter local sources by topic, scope and additive-versus-nutrient intent]
  LR --> U
  LE --> U
  I -.-> L[Topic and scope do not prove semantic entailment]
  LR -.-> L
  V -.-> L
```

## What the implementation establishes

- The conversation route merges records supplied with the request and records returned by tools into the effective evidence set. Before numeric validation, a sentence with an explicit source handle, URL, title or uniquely identifiable publisher is retained only if its source is in this set, topically relevant to the question and in jurisdictional scope when it is a guideline. Clear contextual follow-ups can also use bounded prior user questions for topic continuity; prior assistant text is not evidence, and standalone new topics do not inherit history. A user asking to inspect a supplied reference can inspect it directly.
- The natural answer validator verifies numeric values and printed bases against current package evidence, eligible source text and typed calculations. It withholds unsupported numeric sentences while preserving independently supported prose.
- Consumer source cards are selected from source identities named in the surviving prose; unused or scope-filtered retrieval candidates do not automatically become citations, though they remain available in the inspector.
- These checks establish data flow, numeric support, traceable references and topical/jurisdiction scope. They do not show that a source semantically entails every qualitative scientific statement in the natural answer, and non-numeric scientific prose without an explicit source is not deterministically validated.

## Local deterministic thread path

The UI derives its local audit from the active package. A bounded prior user question may resolve a clearly contextual follow-up, but assistant prose is not carried as evidence. Direct source-backed guidance and claim criteria keep their useful explanation and qualifications; comparisons stay concise. Topic/scope-filtered source identities determine which local evidence cards appear. An additive identity alone cannot establish that a nutrient is present or quantify it.

The production natural-answer path remains plain text by design. A cited source passes based on identity, topic and scope; the route does not deterministically test semantic entailment or unreferenced non-numeric scientific prose. The structured claim-span validator exists separately and is not wired into this natural-answer flow under the 24 October architecture decision. No keyword gate is used.

## Acceptance gap and evidence boundary

The production natural-answer path has no deterministic support check for non-numeric scientific assertions. Prompt instructions, retrieved source availability and a citation card cannot by themselves prove that a medical or nutrition statement is supported. Treat this as an open M2 engineering/acceptance gap; any future design must remain compatible with the plain-text route and avoid lexical classifiers, with distinct scenario acceptance before claiming closure.

This is a code-path audit, not a fresh provider response or scientific evaluation. It uses implementation evidence in `src/lib/server/gemini.ts` and `src/modules/inference/core.ts`; it does not replace Subham's independent evaluation or the missing private KIIT report/template.

## M6 error recovery interaction

```mermaid
flowchart TD
  U[Ask about the active saved package] --> A[Request Gemini answer]
  A -->|unavailable| L[Build on-device package summary]
  L --> F[Show failure detail and preserve package/thread]
  F --> M{Analysis mode}
  M -->|Gemini remains on| R[Explicit Retry Gemini action]
  M -->|user selects local-only| S[Show local reply and no-send recovery guidance]
  S --> E[Turn Gemini on; mode switch sends nothing]
  E --> R
  R --> Q[Repeat the same question for the active package]
  Q --> A
  A -->|response| T[Replace the existing turn]
```

The client owns this mode transition and retry behavior in `src/components/nutriscan.tsx`. Mobile and desktop acceptance intercepts both responses and verifies one failed request, a local-only switch with no request, a separate successful retry, one preserved conversation turn and a still-saved package. The sanitized receipt is `docs/evidence/m6-retry-recovery-20261027.json`; screenshots are local and ignored. It does not establish that Gemini is currently available or that a real model answer is correct.
