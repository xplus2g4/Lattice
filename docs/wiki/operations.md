# Operations

Deployment shape, CI gates, backups, pins, and what happens when things fail.

## Deployment

Single GCP VM, `docker compose`:

```
caddy      :443 → web:3000, api:8000            TLS, one domain
web        TanStack Start (Nitro node server, `node .output/server/index.mjs`)
api        FastAPI + cognee (library)             env: DATABASE_URL, LLM_*, EMBEDDING_*, GCS_*, COGNEE_*,
                                                       RELATED_COURSES_K, COURSE_SUMMARY_REFRESH_S
worker     same image, `python -m lattice.worker`
postgres   pgvector image, volume pgdata
ladybug    no container — file DB on volume graphdata, mounted into api and worker
neo4j      compose profile `neo4j`, off by default
```

Both `api` and `worker` import Cognee, so both mount `graphdata` and point at the same Postgres. Cognee's own config (`ENABLE_BACKEND_ACCESS_CONTROL`, storage backends, LLM/embedding providers) comes from env, identical in both containers.

The migration that creates `course_summaries` runs `CREATE EXTENSION IF NOT EXISTS vector`, so the database must come from the pgvector image (compose and CI do) and the migrating role must be allowed to create extensions; on a managed Postgres, enable `vector` by hand before the first `alembic upgrade head`. The API downloads the fastembed model at start-up if the container has no cache; `RELATED_COURSES_K=0` switches the Related-course lane off without touching the summaries.

## CI and deploys

GitHub Actions (`.github/workflows/ci.yml`) runs three jobs on every PR and on merge to `main`:

- **server**: `ruff check`, `ruff format --check`, `pytest`, then `export_openapi.py --check`
- **app**: `npm run check-api`, `typecheck`, `lint`, `check`
- **canary**: `pytest -m canary`, the isolation gate ([ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md)) and prompt-injection check ([security.md](./security.md))

The last step of `server` and `app` is the contract gate ([ADR 0005](../adr/0005-generated-openapi-contract.md)): the first fails if a response model changed without re-exporting `contracts/openapi.json`, the second if the spec changed without regenerating the web app's types. Neither side of the API can move alone.

The `canary` job is separate because it spends real LLM calls and needs the `LLM_API_KEY` repository secret. The historical ~$0.02 estimate applies only to the isolation test, not the expanded suite. Verify current provider rates and bound retries/output before a budgeted run. Pull requests from forks do not receive secrets, so the job warns and passes there instead of blocking a contributor on a key they cannot have. A missing repository secret also skips execution on internal PRs (#14); a successful skipped job is not evidence of a canary pass.

```sh
uv run pytest -m "not canary"  # offline selection, even with a key configured
uv run pytest -m canary -v    # paid gates; needs LLM_API_KEY
```

Locally `uv run pytest` skips canaries only when no key is configured. Tests disable Cognee's log rotation by default so importing the SDK does not delete old user-level logs. Both live canaries passed locally on 20 Sep 2026; the successful batch's conservative peak-rate cost bound was $0.024236. Each test workspace explicitly scopes `CACHE_DB_URL`: Cognee otherwise memoizes an adapter pointing at the previous temporary root, which can fail after that root is removed. Deploys remain manual; `ssh … docker compose pull && up -d` is the intent.

## Backups

Nightly `pg_dump` and a tarball of `graphdata` go to GCS. The job queue is a Postgres table, so it rides along in the same backup. So does `course_summaries`, but it is derived data: a restore without it is rebuilt by the API's refresh timer on its next pass.

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
| Embedding model download blocked at API start-up (fresh container, Hugging Face rate limit) | Course-summary refresh delayed | The pass fails or waits, is logged, and retries on the next tick; existing summaries keep serving Related courses; `/ask` is unaffected ([#83](https://github.com/xplus2g4/Lattice/issues/83)) |
| Postgres restarted under a running API | Course-summary refresh stalls | The pass holds one connection and has no timeout, so it hangs silently until the API restarts; restart `api` after any Postgres recreate ([#82](https://github.com/xplus2g4/Lattice/issues/82)) |
