# Academic evidence support and current limitations

The existing `evidence-matrix.md`, methodology, bibliography, diagrams, original report and supplied KIIT template remain under the original ignored academic folders. They are not copied into Git or replaced here.

`report_inventory.py` hashes the actual original template and report, inspects their OOXML structure read-only, and checks the existing report-evidence.json source anchors against the selected checkout. It writes no conclusions, author names, ratings or result figures.

```powershell
# Use the bundled document Python runtime supplied by Codex workspace dependencies.
& 'C:/Users/KIIT0001/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' tools/semester-study-ops/report_inventory.py --original-root ../NutriScan --template 'C:/Users/KIIT0001/Downloads/Project_Report-format.docx' --output .data/study-ops/report-audit-next
```

Output is fresh private inventory.json plus pending-study-results.csv. No existing report file is edited. Original paths are explicit arguments so a future custodian can locate their own preserved copy. Direct-body paragraph counts exclude table/nested paragraphs and are not page counts or layout acceptance.

Actual inspection26 October: template SHA256a3ca3ba726f0fa626cccd8462efdea6d2500f3f94793a167d8e999c8383e06ef; draft SHA256cc7dd71cee3ed61fa89dd2455cc331535fa5a1ee7c7c91ba40b554d5fed5635f. Both match previous preservation receipts. Fourteen historical source anchors no longer match the current implementation. These are stale documentation bindings, not proof that features failed. The integration owner must refresh the existing matrix/anchors after freezing relevant code; do not present the older anchored draft as the latest implementation.

## Reuse the existing report workflow

- Chapters1–3: current mission, verified literature, requirements/design and actual source anchors; two research questions and final controlled method definitions.
- Chapter4: center actual implementation, testing and experiments. Existing 3-product development pilot may be included only as exploratory, model/developer-assisted reference evidence. Final five-method accuracy, 27-turn human ratings and nine paired knowledge questions remain PENDING.
- Chapter5: describe actually used coding/testing/design practices without claiming external certification.
- Chapter6: conclusions must follow measured independent evidence; current limitations can be drafted now. No fabricated generalization, study participants, medical validity, originality score, signatures or contributions.

Use scripts/evaluation/generate_report_evidence.py for existing evidence tables/diagrams. It requires correct hash anchors; our inventory identifies drift and does not silently update those anchors. Existing private build_pilot_figures.py retains reproducible development figures; do not relabel them final held-out results.

## Systemic threats to validity to retain

1. Previously exposed development packages cannot establish unseen-product accuracy. Candidate metadata is not rights clearance or independent human reference.
2. Compare the same model/configuration and initial stage; OCR runs necessarily see original pixels locally, but text-only Gemini must receive no image or hidden visual summary. Any later recovery is separate.
3. Fixed one-pass arm order and small exposed development samples cannot establish repeatability or unbiased treatment ranking. Missing OCR timing remains unknown.
4. Package observations, generic composition, hazard assessments, clinical guidance and Indian legal applicability are different evidence classes. Retrieval success does not establish correct recommendation.
5. Incomplete responses, quota failures, model fallback and unequal subsets require explicit denominators. No silent best-run selection.
6. Human scores need actual independent readers, evidence pointers and adjudication. Smooth prose cannot offset a critical fabricated quantity/source or unsafe recommendation.
7. Blinding is limited where source/tool receipts reveal knowledge treatment; disclose it. Reviewer familiarity and evaluator context must be recorded.
8. Latest production changes can invalidate historical report/code anchors and frozen configurations. Retain build and source manifest identities per response.

Owner-controlled formal inputs remain student/guide identities, signatures, institutional originality review, final paper/report approval and final result interpretation.
