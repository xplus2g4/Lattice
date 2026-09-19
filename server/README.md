# server

Backend (API and Worker) for the course knowledge store. Python 3.14, FastAPI, Cognee 1.5.4 in-process, managed with [uv](https://docs.astral.sh/uv/).

First time on a machine: `scripts/dev-setup.sh` from the repo root walks through tooling, dependencies, the DeepSeek key, ports and the embedding model for both `server/` and `app/`. By hand:

```sh
uv sync                                   # installs Python 3.14 and dependencies into .venv
cp .env.example .env                      # then set LLM_API_KEY (DeepSeek)
uv run uvicorn lattice.main:app --reload  # http://localhost:8000, docs at /docs
uv run pytest
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

Layout: `lattice/main.py` builds the FastAPI app (`create_app`), `lattice/config.py` holds settings, `lattice/engine.py` is the only module that imports Cognee, `lattice/registry.py` is the in-memory record of materials, notes and sessions, `lattice/api/` holds routers. Embedded Cognee databases live under `.cognee/`, uploads under `data/uploads/`; both are ignored. See [docs/wiki/components.md](../docs/wiki/components.md) for what the API and Worker own and [docs/research/cognee-1.5.4-first-cut-findings.md](../docs/research/cognee-1.5.4-first-cut-findings.md) for what this cut observed.

```sh
curl -H 'X-User: alice@example.com' -F file=@slides.pdf localhost:8000/courses/cs101/materials
curl -X PUT -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"body_md":"hash tables are week 3"}' localhost:8000/courses/cs101/notes/n1
curl -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"question":"what is a hash table?"}' localhost:8000/courses/cs101/ask
```
