# Primary literature metadata verification

Checked26 October2026 against the nine existing bibliography entries, preserving the original owner bibliography. This is a metadata/documentation refresh, not a new systematic review, independent scientific appraisal, or full-text verification of every study.

Eight primary records were accessible for the declared check depth. L02 remains ACCESS_LIMITED: the publisher returned429 and PubMed yielded no usable metadata in this access attempt. Historical verification notes are preserved; this refresh cannot upgrade them. No paper/model/dataset accuracy ranking was inferred.

Two explicit Unicode corrections are supported by primary records:

- L05: Tobias Pettersson, Maria Riveiro, **Tuwe Löfström** — [publisher record](https://link.springer.com/article/10.1007/s00138-024-01549-9).
- L09: Nandan Thakur, Nils Reimers, **Andreas Rücklé**, Abhishek Srivastava, Iryna Gurevych — [primary arXiv record](https://arxiv.org/abs/2104.08663).

The original file is not edited. The overlay requires exact original-file and old-field hashes, a verified primary URL and an explicit metadata field correction. It cannot modify scientific result fields or use an access-limited record as new verification.

```powershell
python tools/semester-study-ops/bibliography_overlay.py --bibliography ../NutriScan/.data/academic-preparation/bibliography.json --review docs/semester-study-ops/evidence/bibliography-review-20261026.json --output .data/study-ops/bibliography-review-next
```

The output is a fresh private corrected copy and verification-status.csv for owner review. Keep using the existing evidence matrix/bibliography workflow; this is a proposed correction overlay, not a second bibliography authority. HTTP access is not source-body hash archival; the JSON explicitly records that full source bodies were not archived.

Relevant primary records inspected:

| ID | Source | Verification boundary retained |
|---|---|---|
| L01 | https://arxiv.org/abs/2510.03570 | Abstract/version history and source-declared dataset/metric scope; not a fresh full-table audit |
| L02 | https://www.mdpi.com/2313-433X/11/8/271 | ACCESS_LIMITED; full methodology still pending |
| L03 | https://arxiv.org/abs/2110.00061 | Preprint version date and publication year distinguished |
| L04 | https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PP-StructureV3.html | Mutable documentation, not a food-package result |
| L05 | https://link.springer.com/article/10.1007/s00138-024-01549-9 | Publisher metadata/method section; within-class training/validation differs from unseen-product evaluation |
| L06 | https://data.mendeley.com/datasets/3cpx2fmn3r/2 | Version/date/DOI/license declaration; archive and reference quality not verified |
| L07 | https://arxiv.org/abs/2111.15664 | Abstract/version history; no Indian-package result inferred |
| L08 | https://arxiv.org/abs/2005.11401 | Original RAG architecture/task differs from current native clinical/regulatory tools |
| L09 | https://arxiv.org/abs/2104.08663 | Author/version/benchmark metadata; retrieval performance does not establish clinical applicability |

The integration branch advanced to3dceadec9fffabcf39a6680e2aefbf875fac68d5 during this work. No existing scripts/evaluation or data/evaluation files changed between the original0bfe794 base and that checkpoint. No integration-branch checkout/reset/merge was performed; this independent PR remains owner-merged.
