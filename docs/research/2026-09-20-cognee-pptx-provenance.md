# Cognee 1.5.4: PPTX follow-up

20 Sep 2026 (UTC). This supplements the [PDF findings](./2026-09-20-cognee-material-provenance-cost.md), whose PPTX gap was pending a sample. The subsequently supplied `Lecture 7 - MIPS Part 2.pptx` has 40 slides, no hidden or empty slides, and 18,338 characters of slide-local text. SHA256: `771b07394736dd93ba7c2b6f0d78fac713050cd3b95bc6974a5559d530f76dfa`. The original presentation is not committed.

## Native ingestion fails in the current dependency set

[The native attempt](./2026-09-20-material-native-pptx.json) failed during `ingest_data`, before Cognify:

```text
ValueError: No loader found ... (extension '.pptx').
'.pptx' files need an optional document loader that is not installed.
```

The installed loader selector returned `None` for this actual presentation. `python-pptx`, `unstructured` and `docling` were not installed. The lazy `docling_loader` registry entry does not mean its optional package is available. The pinned [loader selector](https://github.com/topoteretes/cognee/blob/20e0bd88746de2d96e99b4b122361dfc3dad21bc/cognee/infrastructure/loaders/LoaderEngine.py) explicitly identifies PPTX as requiring an optional loader.

This exposes a real capability mismatch: [`materials.py`](../../server/lattice/api/materials.py) permits `.pptx`, but the current `cognee[fastembed]` installation cannot ingest it natively. An accepted extension is not evidence of a successful Cognify. No dependency was installed and no production ingestion path was changed during this investigation.

The unsuccessful attempt made only the SDK's connection-check request, with a $0.000051 conservative cost bound. It did not send slide text for extraction.

## Controlled pre-conversion succeeds, but does not create slide citations

[The converted run](./2026-09-20-material-pptx-preconverted.json) extracted text from the presentation's OOXML and placed `# Slide N` headers into one temporary Markdown Material. Slide order came from `presentation.xml` and its relationships, not ZIP entry order or lexical slide filenames. The probe reports hidden slides and excludes speaker notes, masters, images and chart-derived text; it is not a full PowerPoint renderer or a layout-fidelity check.

The resulting Markdown Cognified successfully into **two Chunks**:

| Chunk ordinal | Visible slide headers | Independent anchors found | Structured slide field |
|---|---|---|---|
| 0 | 1–35 | 2, 21, 35 | No usable value |
| 1 | 36–40 | 40 | No usable value |

Thus `chunk_index` is not a slide number, and whole-deck conversion with text headers still merges many slides. These header ranges do not prove that continuation text cannot cross a slide boundary.

Material-level metadata, including the original PPTX hash used as `material_id`, survived. The supplied week/lecture numbers were test sentinels, not inferred teaching facts. Chunk evidence refers to the converted name `lecture.slides`; an eventual conversion implementation must also preserve the mapping back to the original Material, rather than assuming the generated name is a stable user-facing citation target.

The [probe](../../server/scripts/probe_material.py) now supports PDF/PPTX inspection and slide-aware pre-conversion. Its CLI tests check presentation order, hidden-slide reporting, empty slides and exclusion of speaker notes. No slide-aware production chunking or citation deep links were added.

## Usage and scope

Configuration matches the PDF experiment: Cognee 1.5.4, Python 3.14.7, embedded stores, local fastembed, default KnowledgeGraph extraction, `chunks_per_batch=1`, and the configured `openai/deepseek-v4-flash` alias returning `deepseek-flash`.

- Converted Material Cognify: **16,700 input tokens, 50,494 output tokens**, 276.13 seconds.
- Whole converted probe: 310.27 seconds, five provider calls including the connection check.
- Converted-run conservative peak/cache-miss upper bound: **$0.065637**.
- Native failure plus converted run: **$0.065688** additional upper bound.
- Cumulative bound for all work in this session: **$0.198568 of the authorized $2**, with zero unresolved reservations.

The [official pricing table](https://api-docs.deepseek.com/quick_start/pricing) and per-request token receipts underpin these upper bounds; they are not invoices. This is a measurement of the text pre-conversion route, **not native PPTX extraction cost**. One PDF/PPTX pair also does not establish a general cost difference between formats.

## Decision input for #6

The sample gap is closed: native ingestion is unavailable in the current install, while pre-converted slide text is usable but lacks structured slide attribution. The production choice remains either a supported loader configuration or an application-owned conversion path, combined with slide-aware partitioning or validated offset mappings. Installing a loader alone must not be assumed to solve provenance. Any production fix should preserve slide identity across multiple Chunks on a long slide, handle original-Material naming, and explicitly define treatment of hidden slides, notes and non-text content.
