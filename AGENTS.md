# Course knowledge store

Per-course knowledge store: students ask questions scoped to a course and get cited answers from official materials plus their own notes. `server/` (FastAPI + Cognee) and `app/` (TanStack Start) hold a first runnable cut. The Cognee go/no-go is settled for Phase 1 ([ADR 0006](./docs/adr/0006-cognee-go-for-phase-1.md)); Phase 2's concept graph is the open risk.

## Vocabulary

Read [CONTEXT.md](./CONTEXT.md) before writing anything. Use its terms verbatim, including the _Avoid_ lists (say Material, not document; Cognify, not index). CONTEXT.md is a glossary and nothing else; implementation detail goes in the wiki.

## Doc map

- [docs/wiki/architecture.md](./docs/wiki/architecture.md) is the entry point: the one-page view, linking into topic pages (components, data model, flows, security, operations, backlog).
- [docs/adr/](./docs/adr/) holds settled decisions with rationale. Flat, sequentially numbered `NNNN-slug.md`; scan for the highest number and increment.
- [docs/wiki/backlog.md](./docs/wiki/backlog.md) holds decisions deliberately left open and the backlog issues that close them. Check it before proposing a change to the graph store or deployment shape; some "obvious fixes" are deferred on purpose.
- [docs/research/](./docs/research/) holds point-in-time research. Do not update it; supersede it with a new dated file.

## Recording decisions

Write an ADR only when all three hold: hard to reverse, surprising without context, the result of a real trade-off. One to three sentences is a complete ADR; add Considered Options or Consequences only when they earn it. Full format: [.agents/skills/domain-modeling/ADR-FORMAT.md](./.agents/skills/domain-modeling/ADR-FORMAT.md).

## Agent skills

### Issue tracker

Issues live in GitHub Issues at [xplus2g4/Lattice](https://github.com/xplus2g4/Lattice) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: the five canonical labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.

## Backend verification

- Use `uv run --locked pytest -m "not canary"` in `server/` for offline checks. A local key makes plain `pytest` eligible to spend real LLM calls.
- Cognee can populate process environment variables when imported. In isolated tests, `_env_file=None` alone is insufficient: pass identity/MCP flags and temporary storage paths explicitly to `Settings`.
- MCP is opt-in (`MCP_ENABLED=true`, `DEV_HEADER_AUTH=true`) at `/mcp/`, for loopback development only. Run one API process per uploads directory. Page Note records survive restart under `UPLOADS_DIR/.page-notes`; this local adapter is not the planned Postgres Worker deployment.
- The additional paid synthetic study evaluation needs `LATTICE_RUN_STUDY_EVAL=1` and an LLM key; run `uv run --locked pytest tests/test_study_evaluation.py -v`. It records Q&A outputs for review and does not substitute for real-course quality evaluation.
- When relocating existing Cognee storage, stop the API first and check persisted `dataset_database.vector_database_url` values: Cognee 1.5.4 stores absolute LanceDB paths, so changing `COGNEE_ROOT` alone does not rebase existing Datasets. Preserve old content references and record a reversible path mapping.
