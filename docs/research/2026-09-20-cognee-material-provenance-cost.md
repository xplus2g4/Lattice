# Cognee 1.5.4: real-PDF provenance and Cognify cost

20 Sep 2026 (UTC). One user-supplied, text-bearing 40-page Material, `Lecture 7 - MIPS Part 2.pdf`; the original is not committed. Python 3.14.7, embedded stores, local fastembed, default `KnowledgeGraph`, `chunks_per_batch=1` and an 8,191-token Chunk limit. The `openai/deepseek-v4-flash` alias returned `deepseek-flash` (V4.1 Flash), so this is not directly comparable to the September 10 estimate.

| Path / archived evidence | Result | Page attribution |
|---|---|---|
| [Native PDF, live Cognify](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-material-native-pdf.json) | 40 pages became two Chunks; Material metadata and Chunk evidence survived. | No structured page field. Visible headers were 1–35 / 36–40, but page-35 text crossed the boundary. |
| [Markdown page headers, offline chunking comparison](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-material-chunking.json) | Still two multi-page Chunks; headers 1–34 / 35–40. No Cognify or provider calls. | Chosen anchors no longer crossed the boundary in this rendering; that does not prove reliable page attribution. |

The [PDF loader](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/infrastructure/loaders/external/pypdf_loader.py) inserts page labels as text; [TextChunker](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/modules/chunking/TextChunker.py) splits by token budget, not pages. The offline reconstruction confirmed the native page-35 crossing.

| Cost measurement | Result |
|---|---|
| Cognify only | 17,444 input / 43,600 output tokens; 282.20 seconds. |
| Cognify tariff estimates | ~$0.02836 off-peak with reported cache hits; $0.0575532 peak/cache-miss upper bound. |
| Whole live probe | $0.057589 peak upper bound, including the connection check and per-request rounding. |

Costs use [20 Sep pricing](https://api-docs.deepseek.com/quick_start/pricing), not invoices. This one deck does not support the earlier $0.25–0.50 extrapolation or establish a replacement universal budget. No OCR/multimodal extraction was tested, and batching differs from the application default. The requested `LLM_MAX_COMPLETION_TOKENS=16384` cap was absent on the wire; one extraction returned 21,135 output tokens.

**Conclusion:** retain Material metadata, but build page-aware partitioning or validated offset-to-page mappings (#6). Every Chunk from a long page needs its attribution; neither `chunk_index` nor the first visible header is a page number. No production ingest or citation deep-link fix was made. See the [PPTX follow-up](./2026-09-20-cognee-pptx-provenance.md) for the subsequently tested presentation.

Before setting a production per-Material ceiling (#8), measure broader Materials and verify on-wire output limits plus retry/in-flight spending bounds. The current result is a baseline, not a validated spending limit.

Reproduce with the [Material probe](../../server/scripts/probe_material.py). [Full run notes, sample hash and accounting details](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-cognee-material-provenance-cost.md) remain at the original commit.
