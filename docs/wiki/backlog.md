# Backlog

Decisions deliberately left open, and the backlog issues that close most of them. Settled decisions live in [`docs/adr/`](../adr/); this page is only for what is still undecided.

## Deferred decisions

### Ladybug vs Neo4j for the graph store

Current stance: the embedded graph store on a named volume, pinned by the Cognee pin, with Neo4j available as an off-by-default compose profile.

Note the store is **Ladybug** (`ladybug==0.19.0`), not Kuzu: Cognee 1.5.4 resolves Kuzu's successor after the upstream archive ([findings](../research/cognee-1.5.4-first-cut-findings.md)). That is the answer to "what happens when Kuzu is archived", but it does not settle the question. The [memory-engines evaluation](../research/memory-engines-evaluation.md) (Sep 2026) notes the wider ecosystem moving off Kuzu, and Ladybug now carries the same single-maintainer risk one rename later. A pinned embedded file DB keeps working regardless, and it keeps ops to a single VM with file-level backups; if the ecosystem keeps moving, switching the profile default to Neo4j before launch may be cheaper than after. Decide at the go/no-go, with the canary tests as the gate either way.

### Single-VM compose vs anything bigger

Current stance: one GCP VM, docker compose, nightly dumps to GCS. This follows from the self-hosting constraint and current scale, so no ADR. Revisit only if load or availability requirements change; nothing in the architecture assumes a single machine beyond the embedded graph volume.

## Open backlog issues

Close these before the 10 Sep go/no-go. Each is tracked in GitHub. The [first-cut findings](../research/cognee-1.5.4-first-cut-findings.md) answer several; those are marked **answered** and can be closed on GitHub with the finding quoted.

1. **Answered.** Exact `cognee.search` signature for multi-dataset queries, and how `dataset_name` is exposed. A name resolves only among datasets the caller *owns*, so the API must pass `dataset_ids`; one call over N datasets returns one completion per dataset, each carrying `dataset_id` and `dataset_name`, not a fused answer. ([#4](https://github.com/xplus2g4/Lattice/issues/4))
2. **Answered.** `ENABLE_BACKEND_ACCESS_CONTROL` is on by default in 1.5.4, and a wrong-principal `dataset_id` raises `PermissionDeniedError` rather than leaking. So `ASK_TWO_CALL_MODE` is not the default; it stays as the fallback. ([#5](https://github.com/xplus2g4/Lattice/issues/5))
3. **Narrowed.** `add()` takes `external_metadata` and `node_set`, so material-level provenance needs no pre-conversion, and `search(include_references=True)` returns chunk-level `chunk_id`/`chunk_index`/`document_name`. Still open: whether `chunk_index` maps to a slide or page for PDF and PPTX — only `.md` has been ingested. ([#6](https://github.com/xplus2g4/Lattice/issues/6))
4. Ontology format (OWL/RDF vs Pydantic graph model) and whether the graph search types respect it, or whether Phase 2 needs a direct graph query. `cognify()` accepts both an ontology `config` and a `graph_model`, but neither has been exercised; note `INSIGHTS` does not exist in 1.5.4, so the candidates are `TRIPLET_COMPLETION`, `CYPHER` and `GRAPH_REPORT`. ([#7](https://github.com/xplus2g4/Lattice/issues/7))
5. Cognify cost per lecture deck with the chosen extraction model. A 245-token page cost about $0.01 on DeepSeek V4 Flash, extrapolating to $0.25-0.50 for a 40-slide deck, but that is linear extrapolation from one chunk; measure a real deck before setting the ceiling. ([#8](https://github.com/xplus2g4/Lattice/issues/8))
