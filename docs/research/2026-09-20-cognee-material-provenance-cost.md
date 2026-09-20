# Cognee 1.5.4: real-PDF provenance and Cognify cost

20 Sep 2026 (UTC). One complete, user-supplied 40-page PDF was ingested with permission: `Lecture 7 - MIPS Part 2.pdf`, SHA256 `7a9de03cba52fcbdae16e5f4e399286a1ab091ebeb8a907c2fc0a2a8e26d574c`. Local pypdf extraction found 18,549 characters and no empty pages. The original Material is not committed.

Evidence: [live PDF result](./2026-09-20-material-native-pdf.json), [zero-LLM chunking comparison](./2026-09-20-material-chunking.json), and the reproducible [probe](../../server/scripts/probe_material.py). These are observations on one text-bearing PDF, not a guarantee for scanned slides, OCR, images, diagrams or PPTX.

## Configuration

Cognee 1.5.4 on Python 3.14.7, embedded SQLite/LanceDB/Ladybug, fastembed `BAAI/bge-small-en-v1.5` on CPU, default `KnowledgeGraph` extraction and an isolated temporary dataset. `chunks_per_batch=1` bounds concurrent experiment work; therefore measured wall time is not a benchmark of the application's default batching. The default Chunk limit was 8,191 tokens according to Cognee's tokenizer; that count is distinct from provider-reported LLM tokens.

The configured `openai/deepseek-v4-flash` alias returned `deepseek-flash`. The [official documentation](https://api-docs.deepseek.com/) identifies that legacy alias as V4.1 Flash. This is not necessarily the same model behavior as the September 10 first-cut measurement.

## Provenance: Chunk index is not page number

The complete PDF produced **two Chunks**, numbered 0 and 1.

| Observation | Chunk 0 | Chunk 1 |
|---|---|---|
| Page headers visible in native extracted text | 1–35 | 36–40 |
| Independently chosen page anchors found wholly inside the Chunk | 2, 21 | 40 |
| Returned `page` / `slide` fields | Absent | Absent |

The page-35 anchor was not found wholly inside either Chunk. The subsequent local reconstruction using the real `TextChunker` confirmed it **crossed the Chunk boundary**. Consequently Chunk 1 starts with continuation text from page 35 even though its first visible page header is 36. Inferring a page from either `chunk_index` or the first header would be wrong.

`DataItem.external_metadata` round-tripped `material_id`, `week`, and `lecture_no`, together with the supplied node set. The week/lecture numbers were deliberate test sentinels, not inferred teaching facts. This proves Material-level metadata attachment, not per-Chunk page attribution.

Graph context returned segment evidence containing the expected `data_id`, `chunk_id`, `chunk_index` and Material name. Several graph assertions cited the same Chunk, consistent with the existing API dedupe requirement. Neither the inspected Chunk payload nor that evidence supplied a page/slide field.

## Does page-header pre-conversion fix it?

Not by itself. A second, **unpaid** probe reconstructed the native page-header text and compared it with Markdown containing `# Page N` headers. Both went through the pinned `TextChunker` at the same 8,191-token limit; there were zero provider requests and no second Cognify run.

- Native rendering: two Chunks of 8,149 and 1,849 tokenizer tokens; the page-35 anchor crossed their boundary. Header ranges matched the live native-PDF run.
- Markdown headers: two Chunks of 8,176 and 1,901 tokens. Headers 1–34 were in Chunk 0 and 35–40 in Chunk 1; the chosen anchors no longer crossed a boundary in this particular rendering.
- Both representations still merge many pages into each Chunk. Merely moving a boundary does not establish reliable page attribution, especially when a page is longer than a Chunk.

The primary implementations explain why: the [PDF loader](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/infrastructure/loaders/external/pypdf_loader.py) inserts page labels into ordinary text, while [TextChunker](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/chunking/TextChunker.py) batches/splits text by token budget rather than page boundaries. The offline comparison tests that boundary behavior, not the downstream graph produced from Markdown.

**Recommendation:** retain Material metadata, but use page-aware partitioning that propagates the page to every resulting Chunk, or a validated offset-to-page mapping. A long page may produce multiple Chunks, all needing the same page attribution. Do not ship citation deep links based on Chunk indices or guessed headers. No production ingest rewrite or API schema change was made here. PPTX remains unverified: the supplied directory contained PDFs only.

## Cost on the real deck

Use the terminal `cognify_pipeline` record once per `pipeline_run_id`; initiation rows with null usage are not additional operations or measured zeros.

| Operation | Input tokens | Output tokens | Notes |
|---|---:|---:|---|
| Add pipeline | 0 | 0 | PDF extraction/metadata; connection check counted separately below |
| Cognify | 17,444 | 43,600 | Four provider calls: extraction and summarization for each of two Chunks |
| Provenance queries | 0 | 0 | Four CHUNKS queries, a Cypher count and graph `only_context` evidence inspection |
| Initial connection check | 42 | 17 | Visible in the transport ledger, outside the Add pipeline's usage record |

Cognify took **282.20 seconds**; the whole probe took **328.30 seconds** on this Windows environment. The ledger recorded five successful provider requests and no unresolved reservations or additional HTTP attempts for this run. Embeddings were local.

At the [verified current rates](https://api-docs.deepseek.com/quick_start/pricing):

- **Cognify-only peak/cache-miss upper bound:** $0.0575532 before per-request micro-dollar rounding.
- **Whole PDF run ledger upper bound:** **$0.057589**, including the connection check and conservative rounding.
- **Off-peak estimate accounting for 2,816 reported cache-hit input tokens:** approximately **$0.02836** for Cognify, **$0.02838** for the whole run. All requests occurred during the documented Sunday UTC off-peak period. These are tariff estimates, not an invoice reconciliation.

The historical $0.25–0.50 per 40-slide estimate is not supported by this observation. Do not replace it with another universal estimate: this is one text-bearing deck, a changed model alias, a particular chunking/batching setup and no OCR/multimodal extraction.

One extraction returned 21,135 completion tokens. Although the experiment set `LLM_MAX_COMPLETION_TOKENS=16384`, the observed outgoing requests lacked a recognized top-level output cap, so the guard reserved the provider's documented maximum instead. Do not assume the SDK setting alone is a production spending limit; verify on-wire parameters and account for retries/in-flight calls.

**Budget recommendation:** treat these measurements as a baseline, not enough evidence to choose an automatic per-Material ceiling. For discussion, a provisional $0.25 warning/manual-review threshold for similarly sized text-bearing Materials leaves several times the observed peak-rate cost; it is not a validated hard limit. Measure representative longer/text-dense and image-heavy Materials and bound retry/output behavior before enforcing a production ceiling. Issue #8 now has a real-deck measurement; #6 still needs a reliable page-mapping implementation and PPTX validation.
