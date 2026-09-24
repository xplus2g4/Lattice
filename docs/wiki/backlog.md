# Backlog

Decisions deliberately left open, and the backlog issues that close most of them. Settled decisions live in [`docs/adr/`](../adr/); this page is only for what is still undecided.

Settled in [ADR 0006](../adr/0006-cognee-go-for-phase-1.md) and no longer listed here: Cognee stays for Stage 1, and the graph store stays the embedded Ladybug with Neo4j as an off-by-default profile.

## Deferred decisions

### Single-VM compose vs anything bigger

Current stance: one GCP VM, docker compose, nightly dumps to GCS. This follows from the self-hosting constraint and current scale, so no ADR. Revisit only if load or availability requirements change; nothing in the architecture assumes a single machine beyond the embedded graph volume.

### Related-course similarity floor

Current stance: `MIN_SIMILARITY = 0.75` cosine similarity in `server/lattice/db/repo/course_summaries.py`, a magic number guessed on 2026-09-24 for mean-pooled Course summaries, with no measurement behind it ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md)). First numbers, same day ([research](../research/2026-09-24-course-summary-similarities.md)): 0.79 to 1.0 across the four dev courses with summaries, two of them identical uploads, and no unrelated pair in the set, so the floor is untested either way. Those numbers came from the fastembed model since replaced by `text-embedding-3-small`, so they do not carry over. Revisit once a real course set exists: measure similarities between courses known to be related and known to be unrelated, using the [benchmark template](../benchmarks/0000-template.md), then move the floor, or make it a setting, from what that shows.

## Open backlog issues

These gate launch. Each is tracked in GitHub. The [first-cut findings](../research/cognee-1.5.4-first-cut-findings.md) resolved #4 and #5; they can be closed on GitHub with the finding quoted.

1. **Ontology quality and related-concept retrieval.** ([#7](https://github.com/xplus2g4/Lattice/issues/7)) Evaluate real-course extraction quality, ranking, seed/type filtering and citation resolution before production adoption. The [fixture findings](../research/2026-09-20-cognee-ontology-findings.md) recommend a Pydantic-plus-validation and scoped-Cypher prototype, not a production Phase 2 API.
2. **A production per-Material budget.** ([#8](https://github.com/xplus2g4/Lattice/issues/8)) Measure broader Materials and verify on-wire output/retry limits before setting a ceiling. The [real-deck measurement](../research/2026-09-20-cognee-material-provenance-cost.md) replaces the old extrapolation as a baseline, not a universal budget.
3. **Reliable page/slide attribution.** ([#6](https://github.com/xplus2g4/Lattice/issues/6)) Build page/slide-aware partitioning or validated offset mappings; choose a supported PPTX loader/conversion path and preserve original-Material identity. [PDF findings](../research/2026-09-20-cognee-material-provenance-cost.md) and the [PPTX follow-up](../research/2026-09-20-cognee-pptx-provenance.md) show why Chunk indices and text headers are insufficient.
4. **`ASK_TWO_CALL_MODE` is documented but not built.** [flows.md](./flows.md) and [ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md) describe it as a switch; it is not one. Not needed while cross-dataset search isolates, which the canary checks on every run, but the fallback does not exist until someone writes it.
5. **Enable the live CI canaries.** (#14) Both isolation and prompt-injection canaries passed locally on 20 Sep 2026; the remaining gate is the `LLM_API_KEY` repository secret. [security.md](./security.md) records the scope and limits of the injection mitigation. A skipped CI job is not a live pass.

Opened from Related courses ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md), [PR #81](https://github.com/xplus2g4/Lattice/pull/81)); none gates launch, the first is the one to take before relying on the refresh in production:

6. **Course-summary refresh stalls when its database connection drops mid-run.** ([#82](https://github.com/xplus2g4/Lattice/issues/82)) One pooled connection per pass and no timeout; a Postgres restart under the API left it hanging silently on 2026-09-24 until the API restarted.
7. **Persist the fastembed model cache across container restarts.** ([#83](https://github.com/xplus2g4/Lattice/issues/83)) Moot since embeddings moved to OpenAI ([ADR 0007](../adr/0007-openai-embeddings.md)): no model is downloaded at start-up.
8. **`Engine.embedding_model()` instantiates the embedding engine to read its name.** ([#84](https://github.com/xplus2g4/Lattice/issues/84)) Done on every pass, even with nothing to embed.
9. **Related-course references for an unjoined course land on the course page.** ([#85](https://github.com/xplus2g4/Lattice/issues/85)) The reader checks Enrolment; a join prompt that keeps the `material` and `page` parameters, or a read-only global-tier reader, would finish the link.
10. **Opening a session from History no longer scrolls to its last turn.** ([#86](https://github.com/xplus2g4/Lattice/issues/86)) Side effect of scrolling only when a question is sent.

Closed by the findings: `cognee.search` signature and `dataset_name` exposure ([#4](https://github.com/xplus2g4/Lattice/issues/4)); `ENABLE_BACKEND_ACCESS_CONTROL` defaulting on, so `ASK_TWO_CALL_MODE` is not the default ([#5](https://github.com/xplus2g4/Lattice/issues/5)).
