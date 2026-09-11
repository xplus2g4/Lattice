# Backlog

Decisions deliberately left open, and the backlog issues that close most of them. Settled decisions live in [`docs/adr/`](../adr/); this page is only for what is still undecided.

## Deferred decisions

### Kuzu vs Neo4j for the graph store

Current stance: embedded Kuzu on a named volume, pinned to the version matching the pinned Cognee, with Neo4j available as an off-by-default compose profile.

Why this is still open: the [memory-engines evaluation](../research/memory-engines-evaluation.md) (Sep 2026) notes Kuzu was archived after acquisition upstream and has been deprecated in Graphiti. A pinned embedded file DB keeps working regardless, and it keeps ops to a single VM with file-level backups. But if the ecosystem keeps moving away from Kuzu, switching the profile default to Neo4j before launch may be cheaper than after. Decide at the go/no-go, with the canary tests as the gate either way.

### Single-VM compose vs anything bigger

Current stance: one GCP VM, docker compose, nightly dumps to GCS. This follows from the self-hosting constraint and current scale, so no ADR. Revisit only if load or availability requirements change; nothing in the architecture assumes a single machine beyond the embedded Kuzu volume.

## Open backlog issues

Close these before the 10 Sep go/no-go. Each is tracked in GitHub:

1. Exact `cognee.search` signature in the pinned version for multi-dataset queries, and how `dataset_name` is exposed on results. ([#4](https://github.com/xplus2g4/Lattice/issues/4))
2. Whether `ENABLE_BACKEND_ACCESS_CONTROL` isolates by default or must be set explicitly (Cognee issue #2103). Determines whether `ASK_TWO_CALL_MODE` is the default. ([#5](https://github.com/xplus2g4/Lattice/issues/5))
3. Metadata attachment on `add()` for chunk provenance, vs pre-conversion with page headers ([data-model.md](./data-model.md)). ([#6](https://github.com/xplus2g4/Lattice/issues/6))
4. Ontology format (OWL/RDF vs Pydantic graph model) and whether `INSIGHTS` respects it, or whether Phase 2 needs a direct Kuzu query. ([#7](https://github.com/xplus2g4/Lattice/issues/7))
5. Cognify cost per lecture deck with the chosen extraction model. Sets the per-material cost ceiling and the pricing assumptions. ([#8](https://github.com/xplus2g4/Lattice/issues/8))
