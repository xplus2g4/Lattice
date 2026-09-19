# Lattice

A per-course knowledge store. Students ask a question inside one course and get an answer with citations, drawn from the course's official materials, meaning the slides, tutorials and memos an instructor uploaded, and from the student's own notes. Nobody else can read those notes. That single rule shaped most of the design.

The backend is a thin FastAPI service in front of [Cognee](https://github.com/topoteretes/cognee), which does the chunking, entity extraction, embeddings and graph storage. Each course is one Cognee dataset that every enrolled principal can read; each student gets a second, private dataset per course. One `/ask` call searches both. The web app is TanStack Start and talks to the API directly.

This is the first runnable cut, built to answer the open questions before the Cognee go/no-go. It runs on Cognee's embedded stores, which are SQLite, LanceDB and Ladybug. It keeps its own records in memory and trusts an `X-User` header as identity. All three are placeholders for Postgres, a job queue and OAuth; see [docs/wiki/backlog.md](docs/wiki/backlog.md) for what is deliberately not done yet.

## Repository

| Path | What it is |
|---|---|
| `server/` | The API. FastAPI on Python 3.14, managed with uv. `lattice/engine.py` is the only module that imports Cognee. |
| `app/` | The web app. TanStack Start, React 19, Tailwind. A course picker and a per-course page. |
| `contracts/` | `openapi.json`, the frozen API contract. Generated from the API, and the web app's types are generated from it. Never edited by hand. |
| `docs/wiki/` | Architecture, components, data model, flows, security, operations. Start at [architecture.md](docs/wiki/architecture.md). |
| `docs/adr/` | Settled decisions and why. |
| `docs/research/` | Dated findings. [cognee-1.5.4-first-cut-findings.md](docs/research/cognee-1.5.4-first-cut-findings.md) is what the live run showed. |
| `CONTEXT.md` | The glossary. Use its words: Material, Note, Cognify, Tier, Principal. |
| `scripts/dev-setup.sh` | First-time setup wizard. |

## Local development

You need `uv` and Node 26 or newer; uv installs Python 3.14 itself. The only external service is DeepSeek, for the LLM. Embeddings run on your CPU through fastembed, so there is no second key.

The short way:

```sh
scripts/dev-setup.sh
```

It checks the tools, installs both sides, asks for a DeepSeek key and tests it with one request, picks ports, and downloads the embedding model. Re-running it keeps values already saved.

The long way, if you would rather see each step:

```sh
cd server
uv sync
cp .env.example .env         # set LLM_API_KEY; everything else has a working default
uv run uvicorn lattice.main:app --reload    # http://localhost:8000, docs at /docs

cd ../app
npm install
npm run dev                  # http://localhost:3000
```

If port 8000 is taken, start uvicorn with `--port 8010` and put `VITE_API_URL=http://localhost:8010` in `app/.env`.

Then open the web app. Enter a course code on the landing page, `cs101` will do, which takes you to `/courses/cs101`; the user email sits in the header there and the default `alice@example.com` is fine. Upload a `.pdf`, `.pptx`, `.md` or `.txt`. Its status goes `queued`, `cognifying`, `ready`. Cognify is the slow, expensive step, where DeepSeek extracts entities and relations; a page of text takes 10 to 50 seconds. Save a note. Ask something. The answer comes back in two labelled blocks, one per tier, each with the chunks and graph nodes it drew on. Change the email to `bob@example.com` and ask again. The notes block is gone.

Things that will surprise you the first time:

- The materials and notes lists live in API memory. Restart the API and they vanish, though everything stays searchable and re-uploading the same file is a no-op.
- The model name in `.env.example` is `openai/deepseek-v4-flash`, not `deepseek/...`. DeepSeek currently rejects the `json_schema` response format that Cognee's default path sends; the `openai/` prefix routes Cognee to its prompted-JSON fallback. Don't "fix" it.
- `CHUNKS` in the query-type dropdown skips the LLM and returns raw chunks. Useful for checking what retrieval found before blaming the model.

Checks before a PR, the same ones CI runs:

```sh
cd server && uv run ruff check . && uv run ruff format . && uv run pytest
cd server && uv run python scripts/export_openapi.py --check
cd app && npm run check-api && npm run typecheck && npm run lint && npm run check
```

If you changed a response model, the two `--check`s will fail until you regenerate. That is
the point: the web app's types come from the contract, so nothing can change on one side
only ([ADR 0005](docs/adr/0005-generated-openapi-contract.md)).

```sh
cd server && uv run python scripts/export_openapi.py   # contracts/openapi.json
cd app && npm run generate-api                         # app/src/lib/generated/
```

## Frontend

The web app is scoped by URL. `/` is a course picker: type a code matching `^[a-z][a-z0-9]{1,15}$` and it opens `/courses/{code}`. Codes you have opened before are listed as links, kept in `localStorage` under `lattice.courses`. There is no course list from the API yet, so that list is per-browser.

`/courses/{code}` is the working page: Materials, Notes and Ask, one section each, all scoped to the code in the URL. The user email sits in the header and goes out as the `X-User` header, which is the dev-only identity the API accepts while OAuth is unbuilt. Layout and conventions are in [app/README.md](app/README.md).

Two things worth knowing before editing it:

- Materials and Notes poll every 2s while anything is `queued` or `cognifying`, and stop once everything is `ready` or `failed`. Cognify is slow, so expect the poll to run for a while after an upload.
- The session id is stored per course and user under `lattice.session.{course}.{user}`. Changing the email in the header switches to that user's session rather than carrying the current one over.

## Reading order

[CONTEXT.md](CONTEXT.md) first, then [docs/wiki/architecture.md](docs/wiki/architecture.md). The ADRs explain the choices that are hard to undo: Cognee as the engine, two tiers with isolation enforced twice, a Postgres table as the job queue, Python now and Go at the edges. Open questions are GitHub issues, linked from the backlog page.
