# Operations

Deployment shape, CI gates, backups, pins, and what happens when things fail.

## Deployment

One GCE VM (`e2-standard-2`, Debian 12, a static IP; project, zone and instance name live in the ignored `.env.deploy`, see `.env.deploy.example`), running `docker compose -f compose.yaml -f compose.prod.yaml` from `~/lattice/server`:

```
caddy      :80/:443 → $PUBLIC_HOST → web:3000      Let's Encrypt, two hostnames
                      $API_HOST    → api:8000
web        TanStack Start (Nitro node server), app/Dockerfile; VITE_* baked in at build
api        FastAPI + cognee (library), server/Dockerfile   env: DATABASE_URL, LLM_*, EMBEDDING_*, COGNEE_*,
                                                                RELATED_COURSES_K, COURSE_SUMMARY_REFRESH_S,
                                                                LOG_LEVEL, METRICS_TOKEN, SPEND_*, TELEGRAM_*, DEPLOYMENT_NAME
postgres   pgvector image, volume pgdata
ladybug    no container — file DB inside the cognee volume, mounted into api
neo4j      intended compose profile, not built
worker     intended second service from the api image, not built; the API runs its loops
```

`server/compose.prod.yaml` adds `web` and `caddy` to the dev file, closes the published Postgres and API ports, and interpolates hostnames and secrets from `server/.env` (`server/.env.production.example` lists them; `PUBLIC_HOST` and `API_HOST` name the two hosts, and `CORS_ORIGINS` is derived from the first). The API keeps its root-level RPC paths on its own hostname, so the browser talks to it cross-origin with `Authorization: Bearer`. Firewall: tcp 80/443 and udp 443 from anywhere to the `lattice-web` tag; SSH only through IAP (`gcloud compute ssh <vm> --tunnel-through-iap`). The `observability` profile below works there too but is off.

Cognee's own config (`ENABLE_BACKEND_ACCESS_CONTROL`, storage backends, LLM/embedding providers) comes from the same env. One API process per Cognee root, so `api` never scales past one replica on this shape.

The migration that creates `course_summaries` runs `CREATE EXTENSION IF NOT EXISTS vector`, so the database must come from the pgvector image (compose and CI do) and the migrating role must be allowed to create extensions; on a managed Postgres, enable `vector` by hand before the first `alembic upgrade head`. Course summaries are embedded through the same OpenAI model as everything else, so the API needs `EMBEDDING_API_KEY` to refresh them; `RELATED_COURSES_K=0` switches the Related-course lane off without touching the summaries.

For local MCP access, run `uv run --locked python -m lattice.mcp` separately from the API,
with `MCP_ENABLED=true` and `DEV_HEADER_AUTH=true`. The adapter listens on loopback port 8001
and calls `MCP_API_URL` (default `http://127.0.0.1:8000`). It needs no shared volumes or database
connection. The API retains the Cognee root and Note ingestion lock. See
[server setup](../../server/README.md) for client configuration.

### Environment variables for Telemetry, Spend and alerts

All optional; `server/.env.example` carries the same list. Unset, the API behaves as before: no `/metrics`, no Ceiling, no Telegram.

| Variable | Meaning |
|---|---|
| `LOG_LEVEL` | Root log level for the API, Cognee, litellm and uvicorn loggers; default `INFO` |
| `METRICS_TOKEN` | Bearer token for `GET /metrics`; unset, the route is a 404 |
| `SPEND_PRICES_USD_PER_1M` | JSON price table per litellm model name without provider prefix, USD per million tokens, e.g. `{"gpt-4o-mini":{"input":0.15,"output":0.60},"text-embedding-3-small":{"input":0.02}}`; a model with no entry records Spend rows with `usd` null |
| `SPEND_CEILING_USD` | The Ceiling: deployment-wide Spend per UTC day; unset, no Ceiling, no 429, no 80 % alert. Setting it requires a price for both `LLM_MODEL` and `EMBEDDING_MODEL`, or start-up fails naming the unpriced model |
| `TELEGRAM_BOT_TOKEN` | Bot token the watchdog sends alerts with; unset, alerts are logged instead of sent |
| `TELEGRAM_CHAT_ID` | Chat the alerts go to |
| `DEPLOYMENT_NAME` | Name the alerts open with; default `lattice` |
| `VITE_GA_MEASUREMENT_ID` | App build only: the GA4 measurement id; unset, no `gtag` script loads ([security.md](./security.md#egress)) |

## Telemetry and alerts

Logs are one JSON object per line (`ts`, `level`, `logger`, `msg`, `request_id`, exception), with the Cognee, litellm and uvicorn loggers routed through the same formatter. Every response carries `X-Request-Id` (taken from the request or generated); a 502 from `/ask` or the study routes carries the same id in its body, so a user report can be matched to its log lines.

Telemetry is served at `GET /metrics` in Prometheus text format: request counts and latency per route, `/ask` duration, outcome and citation counts per course, Cognify duration and outcome per course and kind, ingest queue depth and age, LLM calls and tokens per model, Spend per course and model, and one `loop_last_tick_timestamp` per lifespan loop. The route is a 404 until `METRICS_TOKEN` is set. Labels name a course at most, never a Principal ([security.md](./security.md#egress)).

Prometheus and Grafana are the `observability` compose profile, off by default:

```sh
cd server && docker compose --profile observability up -d
```

Prometheus (`:9090`, 15 s scrape, 30 d retention, config in `server/ops/prometheus.yml`) reads `METRICS_TOKEN` from `.env` as a compose secret and scrapes `api:8000/metrics` with it, so the one token serves both sides. Grafana (`:3001`, admin / `GRAFANA_ADMIN_PASSWORD` or `admin`) is provisioned from `server/ops/grafana/`: the Prometheus datasource and the **Lattice API** dashboard (loop staleness, ingest queue, request rate and p95 by route, ask outcomes and citations, Cognify outcomes and duration, Spend by course and model, tokens by model). Dashboards are file-provisioned and read-only in the UI; edit the JSON and restart Grafana. Each API process has its own in-memory registry, so this is one target for one process; Alertmanager is not part of the stack because the alerts below come from the API itself.

On the VM the profile is on (`COMPOSE_PROFILES=observability` in `server/.env`, so `deploy.sh` needs no flag). `compose.prod.yaml` closes both host ports: Grafana is served by Caddy at `https://$PUBLIC_HOST/grafana/` (`GF_SERVER_SERVE_FROM_SUB_PATH`, admin / `GRAFANA_ADMIN_PASSWORD` from the VM's `.env`), and Prometheus is reachable only from the compose network or Grafana's datasource proxy.

Alerts come from a third lifespan loop in the API, the watchdog, ticking every 60 s (`WATCHDOG_TICK_S`) and checking Postgres and the other loops' heartbeats:

| Alert | Fires when |
|---|---|
| Ingest stuck | The oldest `queued`, `converting` or `cognifying` Material, or `dirty` or `indexing` Note, has sat in that status for more than 10 min (`ALERT_INGEST_STUCK_S=600`) |
| Loop stalled | The `ingest` or `summaries` loop has not ticked for more than 5 min (`ALERT_LOOP_STALLED_S=300`) |
| Ceiling | Today's Spend reaches 80 % of `SPEND_CEILING_USD` (warning), then 100 % (LLM-spending actions refuse; see the failure table) |

Each alert sends one Telegram message when it starts firing, one when it recovers, and one repeat every 24 h while it stays firing. Delivery is the Telegram Bot API over HTTPS from the API process, 10 s timeout, failures logged and never raised; with no bot token the message is logged at INFO instead. Messages name the deployment (`DEPLOYMENT_NAME`), the alert, the measured value and the threshold. The watchdog heartbeats too, so `/metrics` shows it running, but it cannot report its own process dying.

"API down" therefore lives outside the VM: a Cloud Monitoring uptime check (`lattice-api-health`) fetches `https://$API_HOST/health` every minute from every region, and the **Lattice API down** alert policy opens an incident when two or more regions have failed for 2 min, auto-closing 30 min after recovery. Its notification channel is a webhook straight at the Telegram Bot API `sendMessage` URL with the chat id and a fixed text in the query string (Cloud Monitoring has no Telegram channel and ignores the JSON body it posts), so the message is the same on open and on close and points at the incidents console. Same bot and chat as the watchdog.

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

Locally `uv run pytest` skips canaries only when no key is configured. Tests disable Cognee's log rotation by default so importing the SDK does not delete old user-level logs. Both live canaries passed locally on 20 Sep 2026; the successful batch's conservative peak-rate cost bound was $0.024236. Each test workspace explicitly scopes `CACHE_DB_URL`: Cognee otherwise memoizes an adapter pointing at the previous temporary root, which can fail after that root is removed.

Deploys are manual: `scripts/deploy.sh [ref]` (default `main`) reads the target from `.env.deploy`, SSHes to the VM through IAP, fast-forwards the checkout to `origin/<ref>`, builds both images there, runs `alembic upgrade head` as its own step, then `up -d` and a Caddy reload. Nothing is built locally and no registry is involved. A fresh VM is prepared once with `scripts/deploy.sh --setup` (pipes `server/ops/vm-setup.sh` over the same SSH: git, Docker, the clone), then `server/.env` is written by hand there. A `VITE_*` change (API host, GA id) needs a redeploy, since those values are in the bundle.

## Backups

None. Postgres, the Cognee stores and uploads live only on the VM's boot disk; a lost disk is a lost deployment. Decided for the prototype on 2026-09-25; `course_summaries` would be rebuilt by the refresh timer, nothing else would.

## Pins

`cognee==1.5.4`, `ladybug==0.19.0` (Cognee's embedded graph store, resolved by the Cognee pin), Postgres 16 + pgvector, Python 3.14, Node 26. Bumping Cognee is a deliberate change with the canary tests as the gate.

## Failure modes

| Failure | Effect | Behaviour |
|---|---|---|
| LLM API down during `/ask` | No answer | Return retrieved chunks with citations and `answer_md=""` plus an error banner; never a fabricated answer |
| LLM API down during cognify | Material stuck | Job retries with backoff; `status=failed` after N attempts; instructor re-runs from UI |
| Cognee `search()` raises | No answer | 502 with request id; no partial answer |
| Ladybug file corrupted | Graph queries fail | No backup exists; wipe the `cognee` volume and re-seed every course |
| Loop stalled | Note ingest or Course-summary refresh stops | Watchdog alert after 5 min without a heartbeat; restart `api`. Cognify of a Material is idempotent per hash, and a Note keeps its `dirty` status, so the loop resumes where it stopped |
| Ceiling reached | Every LLM-spending action refuses until midnight UTC | `/ask`, `/study/ask` and `/study/note.review` return 429 with `reset_at` and `Retry-After`; Notes still save but wait as `dirty` for Cognify, no attempt consumed; a Material queued under the Ceiling is marked `failed` with a reset hint and the instructor retries it after the reset; reading and browsing unaffected |
| Cross-dataset search not isolating | Data leak risk | Canary test fails CI; switch `ASK_TWO_CALL_MODE=1` ([flows.md](./flows.md)) |
| Embedding model download blocked at API start-up (fresh container, Hugging Face rate limit) | Course-summary refresh delayed | The pass fails or waits, is logged, and retries on the next tick; existing summaries keep serving Related courses; `/ask` is unaffected ([#83](https://github.com/xplus2g4/Lattice/issues/83)) |
| Postgres restarted under a running API | Course-summary refresh stalls | The pass holds one connection and has no timeout, so it hangs silently until the API restarts; restart `api` after any Postgres recreate ([#82](https://github.com/xplus2g4/Lattice/issues/82)) |
