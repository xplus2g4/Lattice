# Cognee as the knowledge engine

The store needs document ingestion (PDF/PPTX), a concept graph for Phase 2, and two-tier scoping (course-global plus per-user private) queryable in one call, all self-hosted on the existing Postgres/pgvector stack. We evaluated five systems ([research](../research/memory-engines-evaluation.md), Sep 2026) and adopted Cognee as an in-process library: it is the only candidate that covers all four requirements at once. The app layer stays thin enough that a Stage 2 swap to pgvector plus an own concept graph changes nothing above the API contract.

## Considered options

- **Mem0 OSS**: rejected. Open-source graph memory was removed in v3 (April 2026, Platform-only since), which kills Phase 2 for self-hosters; no native document ingestion either.
- **Zep**: rejected. The memory product is cloud-only since Community Edition was deprecated (April 2025). Only the Graphiti library remains self-hostable, and it would need an app layer and a graph DB built around it.
- **Hindsight**: rejected as the foundation. Its bank model cannot fuse a shared course bank and per-user memory in one query, and it is shaped for conversational agent memory, not a document corpus. Its multi-strategy recall is worth borrowing at Stage 2.
- **Mnemosyne**: rejected. Paper only, no maintained implementation.
- **Build our own (pgvector plus concept graph)**: not rejected, deferred. It is the Stage 2 fallback if cognify cost, latency, or extraction quality disappoints.
