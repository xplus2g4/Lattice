# server

Backend (API and Worker) for the course knowledge store. Python 3.14, FastAPI, Cognee 1.5.4 in-process, managed with [uv](https://docs.astral.sh/uv/).

First time on a machine: `scripts/dev-setup.sh` from the repo root walks through tooling, dependencies, the DeepSeek key, ports and the embedding model for both `server/` and `app/`. By hand:

```sh
uv sync                                   # installs Python 3.14 and dependencies into .venv
cp .env.example .env                      # then set LLM_API_KEY (DeepSeek)
uv run uvicorn lattice.main:app --reload  # http://localhost:8000, docs at /docs
uv run pytest                             # the canary skips without an LLM key
uv run pytest -m canary                   # ADR 0002's isolation gate; real LLM calls
uv run ruff check . && uv run ruff format .
uv run python scripts/export_openapi.py          # regenerate contracts/openapi.json
uv run python scripts/export_openapi.py --check  # what CI runs
```

`contracts/openapi.json` is generated from the response models and is the frozen API
contract; the web app's types come from it ([ADR 0005](../docs/adr/0005-generated-openapi-contract.md)).
Change a model and CI fails until you re-export and run `npm run generate-api` in `app/`.
This is also why the models in `lattice/registry.py` declare every always-populated field
as required and pass it explicitly: a Pydantic default is emitted as an optional property,
which would understate what the API actually guarantees.

Configuration comes from the environment; `.env.example` lists every variable, including the ones Cognee reads itself (`LLM_*`, `EMBEDDING_*`). Embeddings run locally through fastembed; the first cognify downloads the model.

Identity is dev-only: with `DEV_HEADER_AUTH=true` the `X-User: <email>` header is the caller. Each email becomes one Cognee principal; materials are ingested as `INSTRUCTOR_EMAIL`.

Both tests marked `canary` spend real LLM calls. `test_private_notes_never_leak` cognifies a Material and a Note, then asserts a second user's `/ask` never carries the first user's Note. `test_retrieved_instructions_do_not_override_grounded_answers` uses poisoned context and checks Graph, RAG and Hybrid answers, an unsupported question and a follow-up. Both require successful Cognify rather than passing on empty tiers. Without `LLM_API_KEY` they skip. Both passed locally on 20 Sep 2026; the repository secret is still pending (#14). The shared `workspace` fixture supplies an explicit per-test `CACHE_DB_URL` so Cognee cannot reuse a default SQL cache pointing at a deleted temporary root.

For reliably offline verification, use `uv run pytest -m "not canary"`, even if a key is configured. `tests/test_prompt_boundary.py` checks the actual Cognee prompt path with external storage/LLM substitutes, including escaped delimiters and session history. The current API has no `not_covered` field; unsupported generated answers are requested as "Not covered by the supplied materials." `CHUNKS` remains raw retrieval. See [security.md](../docs/wiki/security.md) for mitigation limits. Tests disable Cognee log-file rotation by default to avoid deleting user-level logs.

Layout: `lattice/main.py` builds the FastAPI app (`create_app`), `lattice/config.py` holds settings, `lattice/engine.py` owns the Cognee seam with private prompt adapters in `lattice/retrieval.py`, `lattice/registry.py` is the in-memory record of materials, notes and sessions, `lattice/api/` holds routers. Embedded Cognee databases live under `.cognee/`, uploads under `data/uploads/`; both are ignored. See [docs/wiki/components.md](../docs/wiki/components.md) for what the API and Worker own and [docs/research/cognee-1.5.4-first-cut-findings.md](../docs/research/cognee-1.5.4-first-cut-findings.md) for what this cut observed.

```sh
curl -H 'X-User: alice@example.com' -F file=@slides.pdf localhost:8000/courses/cs101/materials
curl -X PUT -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"body_md":"hash tables are week 3"}' localhost:8000/courses/cs101/notes/n1
curl -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"question":"what is a hash table?"}' localhost:8000/courses/cs101/ask
```

## Opt-in Cognee probes

Run these from `server/`. They do not Cognify or call the LLM unless `--run` is supplied:

```sh
uv run python scripts/probe_runtime.py --ledger .cognee/probe-budget.sqlite3
uv run python scripts/probe_ontology.py --variant pydantic
uv run python scripts/probe_ontology.py --variant default --storage-check
uv run python scripts/probe_material.py --material "path/to/deck.pdf"
```

The ontology probe compares `default`, `pydantic` and `owl` extraction; OWL also accepts
`--ontology-mode strict`. Its vocabulary fixture contains no named individuals or answer
facts. `--storage-check` exercises a real, temporary, dataset-scoped Ladybug query without
LLM calls. The Material probe accepts PDF and PPTX and chooses distinctive page/slide anchors
before Cognify, then records Chunk indices, text headers, metadata, evidence and token counts.
PPTX inspection follows presentation relationships and reports hidden slides; it reads slide-local
text/tables, not notes, masters or images. `--directory` inventories both formats locally and
cannot be combined with `--run`. `--preconvert` uses Markdown page/slide headers for an experimental
conversion path. `--chunking-only` checks header behavior through the real Chunker without Cognify
or paid requests; use `--output` to retain results. Native PPTX ingestion currently fails because
its optional loader dependency is absent; no production conversion was installed.

For a paid ontology or Material run, add `--run --ledger .cognee/probe-budget.sqlite3 --output
"path/to/new-results.json"`; the output directory must exist and results are never overwritten.
The guarded canary command is:

```sh
uv run python scripts/probe_runtime.py --ledger .cognee/probe-budget.sqlite3 --run
uv run python scripts/probe_runtime.py --ledger .cognee/probe-budget.sqlite3 --report
```

Reuse the **same ledger** for every experiment in an authorized batch. The transport guard
reserves a conservative whole-context/output upper bound before each request, including SDK
retries, and settles only when valid usage is returned. Failed or unmeasured requests retain
their reservation. It rejects unpriced models, streaming, multiple completions, redirects and
unfunded requests. The limit cannot exceed US$2 or change on reopening a ledger. The report
contains token counts and model identifiers, not prompts, responses or credentials. This is
experiment tooling, not production billing enforcement, and only supports the verified
DeepSeek/LiteLLM HTTPX route with local fastembed embeddings.

Pricing was checked against the [official table](https://api-docs.deepseek.com/quick_start/pricing)
on 20 Sep 2026: `deepseek-v4-flash` is now an alias for V4.1 Flash. The ledger uses peak
cache-miss/input and output rates ($0.30/$1.20 per million tokens), so its dollar figure is an
**upper bound**, not an invoice estimate with cache/off-peak discounts. Recheck pricing before
future runs. Credentials belong in the worktree's ignored `.env` or process environment;
preflight reports readiness without printing them. The [ontology findings](../docs/research/2026-09-20-cognee-ontology-findings.md)
and [PDF provenance/cost findings](../docs/research/2026-09-20-cognee-material-provenance-cost.md),
plus the [PPTX follow-up](../docs/research/2026-09-20-cognee-pptx-provenance.md), record the completed
runs and limitations. Both live canaries passed locally. Production PPTX loader/conversion support,
page/slide-aware ingest and the CI repository secret remain outstanding.
