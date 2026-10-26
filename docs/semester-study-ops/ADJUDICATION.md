# Human adjudication workflow

This closes the bookkeeping gap after two independent reviewers return ratings. It does not make AI judgments or change the underlying experiment/rubric.

```powershell
python tools/semester-study-ops/adjudication.py --ratings .data/study/returned-ratings.json --key .data/study/review-batch-01/custodian/join-key.json
```

The output is a custodian-only disagreement packet. It preserves each reviewer's score, including disagreement between a numerical score and N/A, source pointers and every critical-error record. It binds the full immutable rating set by SHA-256. Keep it out of blinded reviewer materials.

An actual independent adjudicator supplies a separate decisions JSON array. Each row contains blindResponseId, contextSha256, responseSha256 and ratingSetSha256 from that packet; adjudicatorCode (distinct from both readers); provenance independent-human; timezone-aware assessedAt; reason; evidencePointers; all nine scores; notApplicableReasons for null; dimensionReasons for each disputed/changed score; and criticalErrorDecisions.

Each criticalErrorDecisions row identifies the original reviewerCode and zero-based index of their critical error, then gives decision (`confirmed`, `rejected`, `unresolved`), reason and evidencePointer. Every original error must be addressed; unresolved errors keep the response pending. Disagreement is never silently averaged into a final verdict.

```powershell
python tools/semester-study-ops/adjudication.py --ratings .data/study/returned-ratings.json --key .data/study/review-batch-01/custodian/join-key.json --decisions .data/study/adjudicator-decisions.json
```

Original rating files are read-only inputs. Changed responses/context/rating sets, duplicate keys, repeated adjudication, same-reader adjudication, missing reasons and dropped critical errors fail validation. `ADJUDICATED_RECORDS_ONLY` describes accepted declared human records, not independently authenticated participants, scientific correctness or final study completion. Empty/missing studies remain pending.
