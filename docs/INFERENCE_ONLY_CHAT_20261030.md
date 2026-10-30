# Inference-only chat correction — 30 October 2026

The owner paused matched-model execution and superseded queued analytics/report work until this correction is accepted. All previous receipts and incomplete evaluation edits are preserved. This is a product-behavior correction, not a new study.

## Actual paths and disposition

| Path | Previous behavior | Current behavior |
|---|---|---|
| Initial scan / package acceptance with inference off | `buildLocalAuditConversationReply` selected audit sentences and source-linked findings by question patterns | Empty answer plus explicit unavailable/enable/retry state |
| Existing scan updated with photos | Same local reply builder when Gemini unavailable | Same explicit unavailable state; actual enabled requests still use Gemini |
| Initial pasted label with a question | Local audit prose even when Gemini enabled | Actual `/api/assist` call to selected model |
| Added label text with a question | Merged label then local audit prose | Merged evidence then actual selected-model call |
| Label text added without a question | Existing-package path invented a default summary question | Local evidence update only; no generated chat turn or automatic request |
| Ordinary follow-up with inference off | Rule-selected audit text, sometimes wrong default portion | Empty answer and unavailable state; no conversational substitute |
| Provider/network/timeout failure | `buildLocalPackageFallbackReply` assembled identity, servings, ingredients, claims and calculated sentences | Failure/retry state only; successful earlier turns/calculators remain |
| Local evidence follow-up | `buildLocalEvidenceFollowUp` / unavailable helper appended prose after a semantic lookup | Builders and automatic local-answer lookup removed; explicit source search and native model tools remain |
| Partially filtered model answer | Server appended application-written withholding sentences | Only validated model prose is returned as `answer`; withholding information is in separate expandable Answer notes |
| Fully filtered/missing model answer | Application notice could appear as an answered turn | Unavailable/retry state; no fabricated answer |
| Rejected reconstruction recheck | Could attach new attempted tool/provider metadata to retained older answer | Original successful answer and its identity remain intact |
| Historical local/unknown-origin turns | Could render as current conversational answers and enter model history | Original stored bytes retained; displayed as legacy rule-generated turns with retry, never passed as assistant prose/citations; unrecorded origins are likewise not assumed to be model answers |

Removed functions are deleted, not renamed or replaced with another prose generator. New state helpers only create pending/unavailable records with an empty `answer`.

## Deliberately retained boundaries

`buildAudit` still computes deterministic findings, source links, arithmetic and a legacy `Audit.answer` compatibility field for offline callers/tests. Production components/routes do not consume that field as a chat answer. Removing its entire legacy contract would be a separate compatibility change and is unnecessary to isolate chat. Package parsing, quantity parsing, unit conversions, correction precedence, evidence validation and structured inspector/cards remain deterministic. Source-scope and numerical validators still withhold unsupported model spans; they do not write replacement dietary conclusions. Citation rendering, safe text formatting and paragraph folding preserve accepted model text rather than generating summaries. Guidance preselection/tool retrieval remain evidence provision, not local conversation generation.

Enabled saved-package follow-ups retain the existing real Gemini native-tool path. Current reconstructions exclude image bytes and do not repeat photo reconstruction unless explicitly rechecked. Cloud-off mode makes no conversation request. No local LLM provider is claimed. Existing Gemini/provider preference, consent, paid guard settings and production tool declarations are unchanged. The acceptance server explicitly used free Flash-Lite with paid fallback disabled.

Each successful turn persists `answerModel`, taken from returned provider diagnostics rather than selector state. Older answers without a recorded version say that the model was not recorded. Failed requests have no answering-model identity. The selector describes the next request, not the origin of past turns.

Text entry now discloses when an entered question will send text to Gemini and labels that action accordingly; simply adding text remains local.

## Verification

Five actual browser `/api/assist` requests completed using free `gemini-3.5-flash-lite`; twelve matched server provider-request/provider-response pairs. No paid calls. Three synthetic-input requests and two real-photo/package requests are kept distinct:

- Synthetic label, no piece-to-mass relation: Gemini requested missing biscuit weight rather than passing off per-100 g figures as a five-biscuit result.
- Synthetic correction 10 -> 12 g protein/100 g: saved reconstruction follow-up returned 3.6 g protein and 18 g carbohydrate for 30 g; calculator matched. Reopened saved scan preserved correction/model.
- Initial text-entry question: actual Gemini call returned 3 g protein for 20 g from the synthetic 15 g/100 g declaration.
- Retained authorized oats photograph: actual Vision reconstruction and native calculations produced the 30 g response. Real follow-up requested 20 g and reused the current reconstruction with no `visualImages`; only calculator activity, no reconstruction.
- One browser-intercepted HTTP 503: explicit unavailable message and Retry Gemini; no substitute answer. This is a simulated failure, not a genuine provider outage observation. Interception was cleared.
- Inference-off question and text merge without a question: zero API requests; no new generated prose. Earlier valid calculator remained visible.

Full offline suite: 949 passed, 2 skipped across 82 files; final legacy-history refinement: 19 focused tests passed. TypeScript passed. No new optimized build is claimed. Owner overlays are hash-unchanged. Screenshots were visually inspected; HTTP responses and server provider events, not screenshots alone, establish inference.

## Evidence and limits

Sanitized receipt: `docs/evidence/inference-only-chat-20261030.json`. Private versioned evidence: `.data/inference-only-chat-20261030-v1/` (pre-change binary patch, untracked-byte copy, request/response records, server trace hashes, screenshots and acceptance metadata). No credentials or raw photographs are committed.

These are bounded functional checks, not independent package accuracy, clinical correctness or general scientific-grounding acceptance. A synthetic product-name typo remains honestly retained in the raw model response. Benchmarks, statistics and KIIT rewriting remain paused; no formal results are regenerated from this changed application.
