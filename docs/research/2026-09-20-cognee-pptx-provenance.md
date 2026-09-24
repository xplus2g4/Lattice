# Cognee 1.5.4: PPTX follow-up

20 Sep 2026 (UTC). One user-supplied 40-slide Material, `Lecture 7 - MIPS Part 2.pptx`, with no hidden or empty slides; the original is not committed. Same configuration as the [PDF experiment](./2026-09-20-cognee-material-provenance-cost.md): Python 3.14.7, embedded stores, local fastembed, default `KnowledgeGraph`, `chunks_per_batch=1` and the V4.1 Flash alias.

| Path / archived evidence | Outcome | Structured slide attribution | Whole-run peak cost upper bound |
|---|---|---|---:|
| [Native PPTX](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-material-native-pptx.json) | Failed before Cognify: optional loader absent. Only a connection-check request was made. | Not reached | $0.000051 |
| [Text pre-converted to Markdown](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-material-pptx-preconverted.json) | Cognify succeeded: 40 slides became two Chunks, with visible headers 1–35 / 36–40. | None | $0.065637 |

The API [accepts `.pptx`](../../server/lattice/api/materials.py), but the current `cognee[fastembed]` install lacks a supported [optional loader](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/infrastructure/loaders/LoaderEngine.py). Accepting the extension does not make native ingestion work.

The [probe](../../server/scripts/probe_material.py) follows OOXML presentation order and converts slide-local text/tables with `# Slide N` headers; it excludes speaker notes, masters, images and chart-derived text. It is not a layout-fidelity check. Material metadata survived, but Chunk evidence names the converted `lecture.slides`, requiring a mapping back to the original Material.

Converted Cognify used 16,700 input / 50,494 output tokens and took 276.13 seconds. Table costs include connection checks at [20 Sep peak/cache-miss rates](https://api-docs.deepseek.com/quick_start/pricing); they are upper bounds, not invoices or native PPTX extraction costs. One PDF/PPTX pair cannot establish a general format-cost difference.

**Conclusion:** choose a supported loader configuration or application-owned conversion path, together with slide-aware partitioning or validated offset mappings (#6). Installing a loader alone does not solve provenance: `chunk_index` is not a slide number, and text headers do not guarantee that continuation text stays within slide boundaries.

Preserve original-Material identity and slide attribution across multiple Chunks on long slides; define handling of hidden slides, notes and non-text content. No production loader, conversion or citation deep-link fix was added.

[Full run notes and sample hash](https://github.com/xplus2g4/Lattice/blob/b8f845cfae396adea3685a238e469d10782570fc/docs/research/2026-09-20-cognee-pptx-provenance.md) remain at the original commit.
