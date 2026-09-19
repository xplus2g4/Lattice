# Backlog

Decisions deliberately left open, and the backlog issues that close most of them. Settled decisions live in [`docs/adr/`](../adr/); this page is only for what is still undecided.

Settled at the go/no-go ([ADR 0006](../adr/0006-cognee-go-for-phase-1.md)) and no longer listed here: Cognee stays for Stage 1, and the graph store stays the embedded Ladybug with Neo4j as an off-by-default profile.

## Deferred decisions

### Single-VM compose vs anything bigger

Current stance: one GCP VM, docker compose, nightly dumps to GCS. This follows from the self-hosting constraint and current scale, so no ADR. Revisit only if load or availability requirements change; nothing in the architecture assumes a single machine beyond the embedded graph volume.

## Open backlog issues

What the go/no-go left open, in the order worth doing. The [first-cut findings](../research/cognee-1.5.4-first-cut-findings.md) closed #4 and #5; they can be closed on GitHub with the finding quoted.

1. **Ontology and the concept graph. The open risk.** ([#7](https://github.com/xplus2g4/Lattice/issues/7)) Untested, and the reason ADR 0006 is a Phase 1 go rather than an unqualified one: Phase 2 is most of why Cognee beat the alternatives in [ADR 0001](../adr/0001-cognee-as-knowledge-engine.md), and none of it has been run. `cognify()` accepts an ontology `config` and a `graph_model`; neither has been exercised. Note `INSIGHTS` does not exist in 1.5.4, so the candidates are `TRIPLET_COMPLETION`, `CYPHER` and `GRAPH_REPORT`. Exercise this before Phase 2 design leans on it.
2. **Cognify cost on a real deck.** ([#8](https://github.com/xplus2g4/Lattice/issues/8)) $0.25-0.50 per 40-slide deck is extrapolated linearly from one 245-token chunk, which chunking will not respect. Measure a real deck before setting the per-material ceiling.
3. **Chunk provenance for slides.** ([#6](https://github.com/xplus2g4/Lattice/issues/6)) `add()` takes `external_metadata` and `node_set`, and `search(include_references=True)` returns `chunk_id`/`chunk_index`/`document_name`, so the mechanism works. Still open: whether `chunk_index` maps to a slide or page for PDF and PPTX, since only `.md` has been ingested. Citations in the UI depend on the answer.
4. **`ASK_TWO_CALL_MODE` is documented but not built.** [flows.md](./flows.md) and [ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md) describe it as a switch; it is not one. Not needed while cross-dataset search isolates, which the canary checks on every run, but the fallback does not exist until someone writes it.
5. **The prompt-injection canary.** [security.md](./security.md) describes a CI test that ingests a deck with injected instructions and asserts the answer stays grounded. Unwritten.

Closed by the findings: `cognee.search` signature and `dataset_name` exposure ([#4](https://github.com/xplus2g4/Lattice/issues/4)); `ENABLE_BACKEND_ACCESS_CONTROL` defaulting on, so `ASK_TWO_CALL_MODE` is not the default ([#5](https://github.com/xplus2g4/Lattice/issues/5)).
