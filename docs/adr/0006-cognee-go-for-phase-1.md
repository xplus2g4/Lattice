# Cognee go/no-go: go, on Phase 1 evidence only

[ADR 0001](./0001-cognee-as-knowledge-engine.md) adopted Cognee subject to a go/no-go once a runnable cut existed. The gate is passed and Stage 1 proceeds, but on Phase 1 evidence alone: retrieval, two-tier isolation and cost are now measured, while the concept graph that Phase 2 needs has never been exercised. Since that capability is part of why Cognee beat the alternatives in ADR 0001, this is deliberately a narrower "go" than the one that decision anticipated.

## What the gate actually tested

| Question | Outcome |
|---|---|
| Two tiers isolated in one call | Proven. `test_private_notes_never_leak` passes against real Cognee, both enforcement layers ([ADR 0002](./0002-two-tier-datasets-double-isolation.md)), and was shown to go red when the regression it guards against is injected. |
| `search` over datasets the caller does not own ([#4](https://github.com/xplus2g4/Lattice/issues/4)) | Answered. `dataset_ids` is mandatory; one completion comes back per dataset, not a fused answer. |
| Access control default ([#5](https://github.com/xplus2g4/Lattice/issues/5)) | Answered. On by default in 1.5.4; a wrong-principal id raises rather than leaking, so `ASK_TWO_CALL_MODE` is not needed. |
| Chunk provenance ([#6](https://github.com/xplus2g4/Lattice/issues/6)) | Partly. Metadata and chunk-level references work; whether `chunk_index` maps to a slide or page for PDF and PPTX is unverified, because only `.md` has been ingested. |
| Cognify cost ([#8](https://github.com/xplus2g4/Lattice/issues/8)) | Order of magnitude only. $0.25-0.50 per 40-slide deck, extrapolated linearly from a single 245-token chunk. |
| Ontology and concept graph ([#7](https://github.com/xplus2g4/Lattice/issues/7)) | **Untested.** `cognify()` accepts an ontology `config` and a `graph_model`, but neither has been run. |

## Consequences

- Phase 2 remains the open risk, and it is the one that could still trigger the Stage 2 swap. [#7](https://github.com/xplus2g4/Lattice/issues/7) should be the next thing exercised, before Phase 2 design depends on answers nobody has.
- The swap stays cheap, and is cheaper than when ADR 0001 was written: the API contract is now frozen and generated ([ADR 0005](./0005-generated-openapi-contract.md)), so a Stage 2 engine changes nothing above it, and the canary tests the contract rather than the implementation.
- Costs are an estimate, not a budget. Measure a real lecture deck before setting the per-material ceiling that [operations.md](../wiki/operations.md) assumes.
- The graph store stays the embedded one (Ladybug, pinned by the Cognee pin), with Neo4j kept as an off-by-default compose profile. Single-VM ops and file-level backups are worth more than pre-empting an ecosystem move that may not reach us, and the canary gates the pin either way. This closes the question [backlog.md](../wiki/backlog.md) deferred to this gate.
- The wiki stops being draft. Where something is still unproven it now says so in place, rather than the whole document carrying a warning.
