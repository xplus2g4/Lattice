# Backlog

Decisions deliberately left open, and the backlog issues that close most of them. Settled decisions live in [`docs/adr/`](../adr/); this page is only for what is still undecided.

Settled at the go/no-go ([ADR 0006](../adr/0006-cognee-go-for-phase-1.md)) and no longer listed here: Cognee stays for Stage 1, and the graph store stays the embedded Ladybug with Neo4j as an off-by-default profile.

## Deferred decisions

### Single-VM compose vs anything bigger

Current stance: one GCP VM, docker compose, nightly dumps to GCS. This follows from the self-hosting constraint and current scale, so no ADR. Revisit only if load or availability requirements change; nothing in the architecture assumes a single machine beyond the embedded graph volume.

## Open backlog issues

What the go/no-go left open, in the order worth doing. The [first-cut findings](../research/cognee-1.5.4-first-cut-findings.md) closed #4 and #5; they can be closed on GitHub with the finding quoted.

1. **Ontology quality and related-concept retrieval.** ([#7](https://github.com/xplus2g4/Lattice/issues/7)) [Four live variants](../research/2026-09-20-cognee-ontology-findings.md) recovered the expected relationships on a tiny fixture, with dataset isolation and one/two-hop Cypher traversal verified. The prototype recommendation is a constrained Pydantic extraction schema plus semantic validation and scoped Cypher; OWL strict mode is entity grounding, not relationship/domain/range enforcement. Real-course quality, ranking, seed/type filtering and citation resolution remain unverified. No production ontology or new Phase 2 API has been adopted.
2. **A production per-Material budget.** ([#8](https://github.com/xplus2g4/Lattice/issues/8)) A [40-page PDF measurement](../research/2026-09-20-cognee-material-provenance-cost.md) used 17,444 input and 43,600 output tokens for Cognify: about $0.02836 at the observed off-peak/cache rates, below a $0.05756 conservative peak bound. The old $0.25–0.50 extrapolation is not supported by this sample. Broader Materials and reliable on-wire output/retry limits are still needed before adopting a production ceiling.
3. **Reliable page/slide attribution.** ([#6](https://github.com/xplus2g4/Lattice/issues/6)) [The PDF probe](../research/2026-09-20-cognee-material-provenance-cost.md) confirms Material metadata and Chunk evidence work, but 40 pages became two Chunks and a page-35 anchor crossed their boundary. `chunk_index` is not a page number; Markdown page headers alone still merge many pages. Page-aware partitioning or validated offset mappings remain to build. The [PPTX follow-up](../research/2026-09-20-cognee-pptx-provenance.md) now confirms native ingestion fails without an optional loader in the current install. Slide-text pre-conversion succeeds, but 40 slides still become two Chunks with no structured slide attribution. Choose a supported loader/conversion path rather than treating the accepted extension as working support.
4. **`ASK_TWO_CALL_MODE` is documented but not built.** [flows.md](./flows.md) and [ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md) describe it as a switch; it is not one. Not needed while cross-dataset search isolates, which the canary checks on every run, but the fallback does not exist until someone writes it.
5. **Enable the live CI canaries.** (#14) Both isolation and prompt-injection canaries passed locally on 20 Sep 2026; the remaining gate is the `LLM_API_KEY` repository secret. [security.md](./security.md) records the scope and limits of the injection mitigation. A skipped CI job is not a live pass.

Closed by the findings: `cognee.search` signature and `dataset_name` exposure ([#4](https://github.com/xplus2g4/Lattice/issues/4)); `ENABLE_BACKEND_ACCESS_CONTROL` defaulting on, so `ASK_TWO_CALL_MODE` is not the default ([#5](https://github.com/xplus2g4/Lattice/issues/5)).
