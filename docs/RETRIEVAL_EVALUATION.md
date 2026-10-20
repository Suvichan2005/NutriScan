# Local embedding retrieval

Implemented and measured on 21 October 2026 (India time). `POST /api/evidence` accepts `{ "query": "INS 955", "limit": 4 }` with a same-origin localhost request. It returns genuine model cosine scores, lexical BM25 scores, exact identity matches, original source metadata and dated limitations. Returned passages are evidence candidates, never a clinical verdict or proof of current law.

Run `npm run embeddings:prepare` once with internet access, then `npm run embeddings:evaluate`. Preparation downloads approximately 24 MB of Apache-2.0 model/tokenizer assets to ignored `.data/models/`, verifies finite 384-dimensional output, and writes the compact reproducible vector index under `data/`. Runtime queries disable all remote model loading and execute on local Node CPU. No health text or query is sent to Hugging Face. No API key is needed. The server retains a single pipeline and rejects concurrent work while busy; command-line scripts dispose it explicitly.

The pretrained encoder is [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), the Transformers.js ONNX conversion of [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), pinned at revision `751bff37182d3f1213fa05d7196b954e230abad9`. Transformers.js 4.3.1 was measured. Mean pooling and unit normalization follow the model usage. `data/semantic-model-manifest.json` records actual downloaded byte sizes and SHA-256 values. The q8 model itself is 22,972,370 bytes. Runtime does not fabricate vectors or use hand-built concept vectors.

The corpus is the seven original short source summaries in `src/lib/knowledge.ts`: WHO sodium and non-sugar-sweetener guidance, NIDDK diabetes meal education, and four FAO/Codex additive identity records. It redistributes authored summaries and citation metadata, not whole source publications. Corpus version and a SHA-256 of source IDs, text and URLs must match the index; source drift fails closed and requires regeneration. Static retrieval never establishes a current Indian legal permission, product dose or personal carbohydrate target.

## Measured developer evaluation

The 12 queries in `data/semantic-evaluation-queries.json` were written before measurement; exact terms, additive identifiers and paraphrases are mixed. Every query has a declared relevant source ID. `data/semantic-evaluation-results.json` contains individual ranks, actual cosine/BM25 scores, timestamps and latency. Lexical and pure semantic scores rank the full seven-document corpus; hybrid exposes five results. Recall@3 means whether the declared relevant source occurs in the first three results.

| Method | Top-1 correct | Recall@3 | MRR@5 |
|---|---:|---:|---:|
| Lexical BM25 | 11/12 (91.7%) | 12/12 | 0.9583 |
| MiniLM cosine only | 11/12 (91.7%) | 12/12 | 0.9583 |
| Hybrid + exact identity | 12/12 (100%) | 12/12 | 1.0000 |

The two methods make different errors. The blood-pressure paraphrase ranks sodium first semantically and second lexically; lexical matches to generic meal words dominate its BM25 result. Pure embeddings alone confuse the short numeric INS 955 query with a different identity record. The hybrid uses 90% cosine and 10% normalized BM25, with a separate exact-identity boost. An initial 80/20 mix retained the blood-pressure error; the weight was revised after observing that developer case. These are **development/tuning results**, not an independent held-out improvement claim, clinical accuracy, OCR accuracy, or general web-search accuracy. Broader corpora and independently authored held-out queries remain necessary.

First model load in the initial evaluation took about 1.1 seconds; warm retrieval was typically milliseconds on this machine. See exact per-query timings in the result file; this is not a mobile performance guarantee. Remote Gemini, current-law research and genuine-photo OCR acceptance are separate integration gates.

Real localhost Next.js HTTP checks are recorded in `data/semantic-api-receipt.json`: same-origin `INS 955` returned HTTP 200 with `fao-955` first; a blood-pressure paraphrase returned HTTP 200 with `who-sodium` first; missing Origin returned 403; excessive limit returned 400. The check caught and led to repair of Next's localhost-versus-127.0.0.1 Request URL normalization in the shared API gate. These are actual HTTP receipts, not browser screenshots or external provider acceptance.

Known limitations: a tiny English corpus, no calibrated out-of-domain rejection, model token truncation, unknown source supersession, no independent annotation, and no freshness guarantee. Unrelated queries can still retrieve weakly similar passages. The response explicitly reports this limitation; it must not turn a top-ranked passage into a supported answer without checking applicability.
