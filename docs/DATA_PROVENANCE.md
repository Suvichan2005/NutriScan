# Data provenance and licensing

NutriScan distinguishes package observations, user corrections, deterministic calculations, source metadata, product-database records and research abstracts. A value is not promoted from one category into another without preserving the original provenance.

- **OCR text:** produced in the browser with pinned Tesseract.js and bundled English trained data. Confidence is an OCR score, not factual certainty. Original selected images are not part of repository data.
- **Nutrition source corpus:** small curated set of linked WHO, FAO/Codex and NIDDK pages in `src/lib/knowledge.ts`. Each entry records publication scope and limitations in code. Verify each source and its current status before a consequential use.
- **Food records:** explicit Open Food Facts lookup; returned records retain source URL, record date and market/variant limitations. Public records may be incomplete or stale and are not proof of local stock.
- **Scientific search:** Europe PMC results provide candidate article/abstract metadata. Search results are not automatically quality assessments or consensus.
- **Local text embeddings:** pinned MiniLM model metadata, hash and Apache-2.0 license are recorded in `data/semantic-model-manifest.json`. The downloaded model and local index cache are regenerable and ignored; the small curated index and evaluation records are committed for inspection.
- **Synthetic fixtures:** developer-authored labels and annotations are marked as synthetic and never imply accuracy on real food packs.
- **Public product photographs:** the prior real-photo manifest records source URLs and image hashes. Original photos are kept under ignored `docs/evidence/private/`; do not redistribute unless the source license and attribution terms have been checked.

The current repository does not yet contain a comprehensive machine-readable license ledger for every source image, dataset, and model artifact. Review redistribution rights before external publication.
