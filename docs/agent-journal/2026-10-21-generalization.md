# 21 October 2026 — generalization and intake checkpoint

## Scope

Continued the existing local NutriScan implementation. No source history or remote existed before this first checkpoint. Current work corrects example-shaped personalization and fixed two-image intake while retaining the deterministic evidence engine, OCR, research routes and existing green design system.

## Changes

- Replaced the profile contract with empty, optional, separate dietary preference, allergy/intolerance, health consideration, goal, age/reference and location fields. Removed the example-specific meal-count extractor and production calculator. Public search remains independent of the private profile.
- Changed the front/back pair into a variable image collection (up to 10) with add, camera capture, preview, removal, replacement, optional per-photo hint/note and a per-image OCR crop target.
- Added product detail and free-form question fields; product-only investigation can start without a photo. Removed the three canned follow-up chips.
- Updated local follow-up handling to consider only user-declared context when a personal suitability question makes it relevant. The package arithmetic remains deterministic and independent of profile defaults.
- Updated architecture, privacy and acceptance records. The profile remains session-only; no health profile is sent in public searches or saved in history/export.

## Verification level

- Static TypeScript check: passed.
- Unit suite: 53/53 passed.
- Core synthetic suite: 20/20 passed; 29/29 annotated fields, 4/4 annotated absences, 11/11 withholding checks and 19 numerical comparisons.
- Local retrieval suite: 12 queries and 7 documents; hybrid top-1, recall@3 and MRR@5 each measured 1.0 on this developer-authored tuning set.
- Optimized Next production build: passed.
- Current browser screenshot audit: blocked by Codex Work settings, which returned “Local browser use is disabled in Work settings.” No fresh interaction/screenshot acceptance is claimed.
- Provider: Gemini disabled; no key configured and no live call.
- Git: local branch `main`, no configured remote. Checkpoint commit: `d34609bd8503c3f54750fb42fa4cf4e5b299e416`.

## Limits

A real browser pass is still required for dynamic attachments, text-only first question, optional context dialog, mobile layouts, keyboard focus and consented image selection. OCR remains imperfect on glossy, multilingual and multi-column packaging. Product identity and changing regulatory claims need exact, dated corroboration.
