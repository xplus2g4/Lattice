# Lattice

A per-course knowledge store. Students ask a question inside one course and get an answer with citations, drawn from the course's official materials, meaning the slides, tutorials and memos an instructor uploaded, and from the student's own notes. Nobody else can read those notes. That single rule shaped most of the design.

The backend is a thin FastAPI service in front of [Cognee](https://github.com/topoteretes/cognee), which does the chunking, entity extraction, embeddings and graph storage. Each course is one Cognee dataset that every enrolled principal can read; each student gets a second, private dataset per course. One `/ask` call searches both. The web app is TanStack Start and talks to the API directly.

This is the first runnable cut. It runs on Cognee's embedded stores, which are SQLite, LanceDB and Ladybug. It keeps its own records in memory and trusts an `X-User` header as identity. All three are placeholders for Postgres, a job queue and OAuth; see [docs/wiki/backlog.md](docs/wiki/backlog.md) for what is deliberately not done yet.

## Repository

| Path | What it is |
|---|---|
| `server/` | The API. FastAPI on Python 3.14, managed with uv. `lattice/engine.py` is the only module that imports Cognee. |
| `app/` | The web app. TanStack Start, React 19, Tailwind. One route. |
| `docs/wiki/` | Architecture, components, data model, flows, security, operations. Start at [architecture.md](docs/wiki/architecture.md). |
| `docs/adr/` | Settled decisions and why. |
| `docs/research/` | Dated findings. [cognee-1.5.4-first-cut-findings.md](docs/research/cognee-1.5.4-first-cut-findings.md) is what the live run showed. |
| `CONTEXT.md` | The glossary. Use its words: Material, Note, Cognify, Tier, Principal. |
| `AGENTS.md`, `.agents/skills/` | Instructions and skills for coding agents. `CLAUDE.md` and `.claude/skills` point Claude Code at them. |
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

Then open the web app. Course code and user email sit at the top; the defaults `cs101` and `alice@example.com` are fine. Upload a `.pdf`, `.pptx`, `.md` or `.txt`. Its status goes `queued`, `cognifying`, `ready`. Cognify is the slow, expensive step, where DeepSeek extracts entities and relations; a page of text takes 10 to 50 seconds. Save a note. Ask something. The answer comes back in two labelled blocks, one per tier, each with the chunks and graph nodes it drew on. Change the email to `bob@example.com` and ask again. The notes block is gone.

Things that will surprise you the first time:

- The materials and notes lists live in API memory. Restart the API and they vanish, though everything stays searchable and re-uploading the same file is a no-op.
- The model name in `.env.example` is `openai/deepseek-v4-flash`, not `deepseek/...`. DeepSeek currently rejects the `json_schema` response format that Cognee's default path sends; the `openai/` prefix routes Cognee to its prompted-JSON fallback. Don't "fix" it.
- `CHUNKS` in the query-type dropdown skips the LLM and returns raw chunks. Useful for checking what retrieval found before blaming the model.

Checks before a PR:

```sh
cd server && uv run ruff check . && uv run ruff format . && uv run pytest
cd app && npm run typecheck && npm run lint && npm run check
```

## Reading order

[CONTEXT.md](CONTEXT.md) first, then [docs/wiki/architecture.md](docs/wiki/architecture.md). The ADRs explain the choices that are hard to undo: Cognee as the engine, two tiers with isolation enforced twice, a Postgres table as the job queue, Python now and Go at the edges. Open questions are GitHub issues, linked from the backlog page.
