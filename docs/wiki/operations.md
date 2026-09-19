# Operations

Deployment shape, CI gates, backups, pins, and what happens when things fail.

## Deployment

Single GCP VM, `docker compose`:

```
caddy      :443 → web:3000, api:8000            TLS, one domain
web        TanStack Start (Nitro node server, `node .output/server/index.mjs`)
api        FastAPI + cognee (library)             env: DATABASE_URL, LLM_*, EMBEDDING_*, GCS_*, COGNEE_*
worker     same image, `python -m lattice.worker`
postgres   pgvector image, volume pgdata
ladybug    no container — file DB on volume graphdata, mounted into api and worker
neo4j      compose profile `neo4j`, off by default
```

Both `api` and `worker` import Cognee, so both mount `graphdata` and point at the same Postgres. Cognee's own config (`ENABLE_BACKEND_ACCESS_CONTROL`, storage backends, LLM/embedding providers) comes from env, identical in both containers.

## CI and deploys

GitHub Actions (`.github/workflows/ci.yml`) runs two jobs on every PR and on merge to `main`:

- **server**: `ruff check`, `ruff format --check`, `pytest`, then `export_openapi.py --check`
- **app**: `npm run check-api`, `typecheck`, `lint`, `check`

The last step of each is the contract gate ([ADR 0005](../adr/0005-generated-openapi-contract.md)): the first fails if a response model changed without re-exporting `contracts/openapi.json`, the second if the spec changed without regenerating the web app's types. Neither side of the API can move alone.

Not yet wired: the two canary tests ([security.md](./security.md)) need an LLM key secret and a cognify per run, so they are still manual. Deploys are still manual too; `ssh … docker compose pull && up -d` is the intent.

## Backups

Nightly `pg_dump` and a tarball of `graphdata` go to GCS. The job queue is a Postgres table, so it rides along in the same backup.

## Pins

`cognee==1.5.4`, `ladybug==0.19.0` (Cognee's embedded graph store, resolved by the Cognee pin), Postgres 16 + pgvector, Python 3.14, Node 26. Bumping Cognee is a deliberate change with the canary tests as the gate.

## Failure modes

| Failure | Effect | Behaviour |
|---|---|---|
| LLM API down during `/ask` | No answer | Return retrieved chunks with citations and `answer_md=""` plus an error banner; never a fabricated answer |
| LLM API down during cognify | Material stuck | Job retries with backoff; `status=failed` after N attempts; instructor re-runs from UI |
| Cognee `search()` raises | No answer | 502 with request id; no partial answer |
| Ladybug file corrupted | Graph queries fail | Restore `graphdata` from nightly tarball; Phase 1 (vector path) still works if graph search is disabled via flag |
| Worker crashes mid-job | Job locked | `locked_by` plus heartbeat; stale locks released after timeout; cognify is idempotent per material hash |
| Per-user budget exhausted | `/ask` refused | 429 with reset time; notes and browsing unaffected |
| Cross-dataset search not isolating | Data leak risk | Canary test fails CI; switch `ASK_TWO_CALL_MODE=1` ([flows.md](./flows.md)) |
