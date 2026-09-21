# server

Backend (API and Worker) for the course knowledge store. Python 3.14, FastAPI, Cognee 1.5.4 in-process, managed with [uv](https://docs.astral.sh/uv/).

First time on a machine: `scripts/dev-setup.sh` from the repo root walks through tooling, dependencies, the DeepSeek key, ports and the embedding model for both `server/` and `app/`. By hand:

```sh
uv sync                                   # installs Python 3.14 and dependencies into .venv
cp .env.example .env                      # then set LLM_API_KEY (DeepSeek)
uv run alembic upgrade head               # application tables in Postgres
uv run uvicorn lattice.main:app --reload  # http://localhost:8000, docs at /docs
uv run pytest                             # needs Postgres; see below
uv run ruff check . && uv run ruff format .
```

Application records (users, courses, materials, notes, sessions, quizzes, the job queue) live in
Lattice's own Postgres, reached through `DATABASE_URL`; Cognee keeps its own embedded stores and is
not part of that database. Migrations are Alembic: `uv run alembic upgrade head`, or set
`DATABASE_AUTO_MIGRATE=true` to have start-up do it in dev. Tests need a Postgres too and create
their own database from `TEST_DATABASE_URL` (default `…/lattice_test`).

Configuration comes from the environment; `.env.example` lists every variable, including the ones Cognee reads itself (`LLM_*`, `EMBEDDING_*`). Embeddings run locally through fastembed; the first cognify downloads the model.

Identity is dev-only: with `DEV_HEADER_AUTH=true` the `X-User: <email>` header is the caller. Each email becomes one Cognee principal; materials are ingested as `INSTRUCTOR_EMAIL`.

Layout: `lattice/main.py` builds the FastAPI app (`create_app`), `lattice/config.py` holds settings, `lattice/engine.py` is the only module that imports Cognee, `lattice/db/` holds the SQLAlchemy models, the session dependency and the Alembic helpers (migrations in `migrations/`), `lattice/registry.py` is the in-memory record of materials, notes and sessions that the Postgres tables are replacing, `lattice/api/` holds routers. Embedded Cognee databases live under `.cognee/`, uploads under `data/uploads/`; both are ignored. See [docs/wiki/components.md](../docs/wiki/components.md) for what the API and Worker own and [docs/research/cognee-1.5.4-first-cut-findings.md](../docs/research/cognee-1.5.4-first-cut-findings.md) for what this cut observed.

```sh
curl -H 'X-User: alice@example.com' -F file=@slides.pdf localhost:8000/courses/cs101/materials
curl -X PUT -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"body_md":"hash tables are week 3"}' localhost:8000/courses/cs101/notes/n1
curl -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"question":"what is a hash table?"}' localhost:8000/courses/cs101/ask
```
