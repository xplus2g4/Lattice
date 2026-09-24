# Lattice

A per-course knowledge store. Students ask a question inside one course and get an answer with citations, drawn from the course's official materials, meaning the slides, tutorials and memos an enrolled user uploaded, and from the student's own notes. Nobody else can read those notes. That single rule shaped most of the design.

The backend is a thin FastAPI service in front of [Cognee](https://github.com/topoteretes/cognee), which does the chunking, entity extraction, embeddings and graph storage. Each course is one Cognee dataset that every enrolled principal can read; each student gets a second, private dataset per course. One `/ask` call searches both. The web app is TanStack Start and talks to the API directly.

This runnable cut uses Cognee's embedded SQLite, LanceDB and Ladybug stores for knowledge, and a separate Postgres database for application records. Identity still uses a development-only `X-User` header; Enrolment and ownership are checked against the persistent records. The API runs background ingest while the dedicated Worker queue and OAuth remain future work; see [docs/wiki/backlog.md](docs/wiki/backlog.md).

## Repository

| Path | What it is |
|---|---|
| `server/` | The API. FastAPI on Python 3.14, managed with uv. `lattice/engine.py` owns the Cognee interface, with prompt adapters in `lattice/grounding.py`. |
| `app/` | The web app. TanStack Start, React 19, Tailwind. A course picker and a per-course page. |
| `contracts/` | `openapi.json`, the frozen API contract. Generated from the API, and the web app's types are generated from it. Never edited by hand. |
| `docs/wiki/` | Architecture, components, data model, flows, security, operations. Start at [architecture.md](docs/wiki/architecture.md). |
| `docs/adr/` | Settled decisions and why. |
| `docs/research/` | Dated findings. [cognee-1.5.4-first-cut-findings.md](docs/research/cognee-1.5.4-first-cut-findings.md) is what the live run showed. |
| `CONTEXT.md` | The glossary. Use its words: Material, Note, Cognify, Tier, Principal. |
| `AGENTS.md`, `.agents/skills/` | Instructions and skills for coding agents. `CLAUDE.md` and `.claude/skills` point Claude Code at them. |
| `scripts/dev-setup.sh` | First-time setup wizard. |

## Local development

You need `uv` and Node 26 or newer; uv installs Python 3.14 itself. The API also needs Postgres; `server/compose.yaml` provides a local instance. DeepSeek supplies the LLM. Embeddings run on your CPU through fastembed, so there is no second key.

The short way:

```sh
scripts/dev-setup.sh
```

It checks the tools, installs both sides, asks for a DeepSeek key and tests it with one request, picks ports, and downloads the embedding model. Re-running it keeps values already saved.

The long way, if you would rather see each step:

```sh
cd server
uv sync
docker compose up -d postgres
cp .env.example .env         # set LLM_API_KEY; everything else has a working default
uv run alembic upgrade head
uv run uvicorn lattice.main:app --reload    # http://localhost:8000, docs at /docs

cd ../app
npm install
npm run dev                  # http://localhost:3000
```

If port 8000 is taken, start uvicorn with `--port 8010` and put `VITE_API_URL=http://localhost:8010` in `app/.env`.

Then open the web app. Enter a course code on the landing page, `cs101` will do, which takes you to `/courses/cs101`; the user email sits in the header there and the default `alice@example.com` is fine. Upload a `.pdf`, `.pptx`, `.md` or `.txt`. Its status goes `queued`, `cognifying`, `ready`. Cognify is the slow, expensive step, where DeepSeek extracts entities and relations; a page of text takes 10 to 50 seconds. Save a note. Ask something. The answer comes back in two labelled blocks, one per tier, each with the chunks and graph nodes it drew on. Change the email to `bob@example.com` and ask again. The notes block is gone.

Things that will surprise you the first time:

- The frontend talks to the RPC API at `VITE_API_URL`, so the server has to be running. Application records survive API restarts in Postgres; Cognee knowledge lives in its separate embedded store.
- The model name in `.env.example` is `openai/deepseek-v4-flash`, not `deepseek/...`. DeepSeek currently rejects the `json_schema` response format that Cognee's default path sends; the `openai/` prefix routes Cognee to its prompted-JSON fallback. Don't "fix" it.
- `CHUNKS` in the query-type dropdown skips the LLM and returns raw chunks. Useful for checking what retrieval found before blaming the model.
- On Windows, a material can sit at `cognifying` and then fail with a LanceDB `failed to persist temp file` error. That is `MAX_PATH`, not Cognee: the embedded stores nest about 185 characters below `COGNEE_ROOT`, so a checkout more than ~75 characters deep crosses 260. Enable long path support (`LongPathsEnabled`, admin, then reboot) or keep the checkout shallow, say `C:\dev\Lattice`. It is a per-machine registry setting, so it does not come with the clone and each Windows machine needs it; `scripts/dev-setup.sh` checks and tells you which case you are in.

Checks before a PR, the same ones CI runs:

```sh
cd server && uv run ruff check . && uv run ruff format --check . && uv run pytest -m "not canary"
cd server && uv run python scripts/export_openapi.py --check
cd app && npm run check-api && npm run typecheck && npm test && npm run lint && npm run check
```

If you changed a response model, the two `--check`s will fail until you regenerate. That is
the point: the web app's types come from the contract, so nothing can change on one side
only ([ADR 0005](docs/adr/0005-generated-openapi-contract.md)).

```sh
cd server && uv run python scripts/export_openapi.py   # contracts/openapi.json
cd app && npm run generate-api                         # app/src/lib/generated/
```

## Frontend

The web app is scoped by URL. `/` is a course picker: type a code matching `^[a-z][a-z0-9]{1,15}$` and it opens `/courses/{code}`. Codes you have opened before are listed as links, kept in `localStorage` under `lattice.courses`. The home screen combines enrolled courses from the API with the browser's course library.

`/courses/{code}` opens the reader workspace with Materials, Notes and Ask. The existing `/materials`, `/notes` and `/ask` study routes remain available, including direct Session URLs. The email goes out as the `X-User` header, which is the dev-only identity the API accepts while OAuth is unbuilt. Layout and conventions are in [app/README.md](app/README.md).

Two things worth knowing before editing it:

- Materials and Notes poll every 2s while anything is `queued` or `cognifying`, and stop once everything is `ready` or `failed`. Cognify is slow, so expect the poll to run for a while after an upload. Because the sections are separate routes now, only the one you are looking at polls.
- A conversation is a URL. Asking on `/courses/{code}/ask` moves you to `/courses/{code}/ask/{session}`, so a conversation survives a reload, can be linked, and back and forward work through it. A session the API has forgotten sends you back to `/ask` rather than showing a 404.

## Reading order

[CONTEXT.md](CONTEXT.md) first, then [docs/wiki/architecture.md](docs/wiki/architecture.md). The ADRs explain the choices that are hard to undo: Cognee as the engine, two tiers with isolation enforced twice, a Postgres table as the job queue, Python now and Go at the edges. Open questions are GitHub issues, linked from the backlog page.
