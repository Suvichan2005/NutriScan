# 2026-10-27 — source navigation is not answer evidence

## Observation

A bounded real free-tier allergen question returned no local knowledge records. The external research tool returned official FSSAI/Gazette navigation links after it could not retrieve source text. The final response included allergen-label explanations, but the returned links did not contain retrieved legal text and explicitly disclaimed being legal evidence. This is a retrieval coverage failure plus a source-role contract gap; it does not establish scientific or legal correctness.

## Change

Added optional `supportRole` metadata to evidence source contracts. External research marks failed retrieval links and the flattened FSSAI additive index as `navigation`. These records remain available to open, but they are excluded from conversational citations and explicitly cited navigation-only sentences are rejected. Content-bearing research remains eligible under existing topic and jurisdiction checks.

## Verification and limits

Focused test run: 211 passed, 1 skipped. `npm run typecheck` passed. No live provider call, browser acceptance, or scientific evaluation followed the change. Local allergen-source coverage remains missing; model behavior still needs a later bounded acceptance run after the corpus/tool path is repaired.
