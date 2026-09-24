# server

Backend (API and Worker) for the course knowledge store. Python 3.14, FastAPI, Cognee 1.5.4 in-process, managed with [uv](https://docs.astral.sh/uv/).

First time on a machine: `scripts/dev-setup.sh` from the repo root walks through tooling, dependencies, the DeepSeek key, ports and the embedding model for both `server/` and `app/`. By hand:

```sh
uv sync                                   # installs Python 3.14 and dependencies into .venv
cp .env.example .env                      # then set LLM_API_KEY (DeepSeek)
uv run alembic upgrade head               # application tables in Postgres
uv run uvicorn lattice.main:app --reload  # http://localhost:8000, docs at /docs
uv run pytest -m "not canary"             # needs Postgres; no paid LLM calls
uv run pytest -m canary                   # needs Postgres and an LLM key; real calls
uv run ruff check . && uv run ruff format .
uv run python scripts/export_openapi.py          # regenerate contracts/openapi.json
uv run python scripts/export_openapi.py --check  # what CI runs
```

`contracts/openapi.json` is generated from the response models and is the frozen API
contract; the web app's types come from it ([ADR 0005](../docs/adr/0005-generated-openapi-contract.md)).
Change a model and CI fails until you re-export and run `npm run generate-api` in `app/`.
This is also why the models in `lattice/api/schemas.py` declare every always-populated field
as required and pass it explicitly: a Pydantic default is emitted as an optional property,
which would understate what the API actually guarantees.

Or with Docker, which brings its own Postgres and needs no uv or Python on the host:

```sh
cp .env.example .env                      # then set LLM_API_KEY (DeepSeek)
docker compose up --build                 # http://localhost:8000; migrations run on start-up
```

`compose.yaml` runs the API against a `pgvector` Postgres 16 and keeps Postgres data, Cognee's
embedded stores (`/srv/.cognee`) and uploads (`/srv/data/uploads`) in named volumes, so a rebuild
keeps a cognified course. It reads `.env` for everything except `DATABASE_URL` (the `postgres`
service) and `DATABASE_AUTO_MIGRATE` (on, so `up` is enough). The Worker has no entrypoint yet;
when it does, it is another service from the same image.

## Seeding a course

`scripts/seed-wizard.sh` is the guided path: it asks for the course, imports the slide files,
puts a DeepSeek key in `.env`, waits until the API answers, then shows the cost of cognifying
what it found and seeds it once you agree.

```sh
scripts/seed-wizard.sh
```

Underneath it, `scripts/seed_course.py` fills a running API with a course and its lecture
Materials, over the same RPC endpoints an instructor uses, with dev-header identity. Slide bytes
are not in the repository: unzip a course's files into `data/seed/<CODE>/` (ignored) or point
`--source` at the zip. Filenames of the form `L02a - Instruction Level Parallelism - Part I.pdf`
supply the Material title, `lecture_no` and `page_count`.

```sh
unzip -j CS4223.zip -x '__MACOSX/*' -d data/seed/CS4223
uv run python scripts/seed_course.py --dry-run             # inventory and cost, upload nothing
uv run python scripts/seed_course.py                       # cs4223, then waits for ingest
uv run python scripts/seed_course.py --only L00,L01        # two decks
uv run python scripts/seed_course.py --source ~/CS4223.zip --course cs3210 --name "…"
```

Re-running is safe and cheap: an existing code comes back as the 409 carrying the course, and
uploads are content-addressed, so unchanged bytes rejoin the existing Material and cognify nothing.
Cognifying a new deck does spend real LLM calls, so both entry points state an estimate first and
ask before uploading (`--yes` skips the prompt, `--only` seeds a subset, `--no-wait` returns once
everything is queued). The estimate scales the extracted text by crude prompt and output
multipliers at DeepSeek's peak rates: an order of magnitude, not a quote. The eight CS4223 decks
(371 pages, 21 MB) estimated US$0.06 and took 12 minutes of wall clock to reach `ready`.
The exit status is non-zero if any ingest ends `failed` or is still running when
`--ingest-timeout` expires.

Application records (users, courses, materials, notes, sessions and quizzes) live in
Lattice's own Postgres, reached through `DATABASE_URL`; Cognee keeps its own embedded stores and is
not part of that database. Migrations are Alembic: `uv run alembic upgrade head`, or set
`DATABASE_AUTO_MIGRATE=true` to have start-up do it in dev. Tests need a Postgres too and create
their own database from `TEST_DATABASE_URL` (default `…/lattice_test`); it must have pgvector
available (the `pgvector/pgvector:pg16` image does), because the course-summaries migration
enables the `vector` extension.

The persisted endpoints are RPC-shaped: a verb-named path, GET with query arguments for reads and
POST with a JSON body for writes (`/me.get`, `/courses.search`, `/courses.create`,
`/enrolments.join`, `/materials.upload`, `/topics.replace`, `/readingPosition.set`, …). Nothing is
stored in the former application Registry: the `/courses/{course}/...` routes and `registry.py` are gone.

Materials are content-addressed: `/materials.upload` hashes the bytes and a file already in the
course comes back as the existing Material with `deduplicated: true`, cognifying nothing. Ingest
runs in the background and writes `status` (`queued`, `cognifying`, `ready`, `failed`) plus `error`
onto the Material; `/materials.retry` requeues a failed one.

A Note is private to the student who wrote it: `/notes.save` is an upsert on (student, material,
page), so autosaving a page rewrites one row rather than piling them up, and a Note with no
material is a loose jotting on the course. Saving cognifies into the author's private Dataset
unless they set `notes_opt_out`, tracked on the Note as `status` (`dirty`, `indexing`, `ready`,
`failed`). Notes carry `revision` and `cognified_revision`; an optional `expected_revision` on
`/notes.save` rejects stale edits with 409. Identical content is idempotent, and an empty edit
clears the searchable private content. The API coalesces dirty Notes and recovers interrupted
ingest; the general Worker job queue remains a separate deployment step.

Set `MCP_ENABLED=true` with development identity enabled to mount `/mcp/` over Streamable HTTP.
It is loopback-only, rejects forwarded identity, and uses the same Postgres records, Enrolment
checks and `notes_opt_out` setting as RPC. Run one API process per Cognee root. Existing local
`.page-notes` JSON records are not automatically imported or deleted; migrate them explicitly
before relying on the database as their only copy.

`/ask` appends two Turns to a Session — the question, then the answer with its Tier results and
the chunks they cite — so `/sessions.get` replays a conversation after a reload and `/sessions.list`
shows a student's conversations in a course, newest first. A Session is readable only by the
student who asked, and `/feedback.record` puts one rating per student on an answer. With Related
courses on, the answer also carries a `related` tier per nearest course: a few bullet points from
that course's Materials, searched as the instructor principal over its global Dataset alone
([ADR 0007](../docs/adr/0007-related-courses-from-summary-neighbours.md)).

Quizzes are records only: something else writes the questions and marks the answers, and
`/quizzes.create` stores the result, `/quizAnswers.record` keeps every attempt as its own row, and
`/quizStats.byTopic` counts attempts and misses per Topic for weighting later questions. A Quiz is
private to the student it was set for, and closes once through `/quizzes.submit` or
`/quizzes.abandon`.

Configuration comes from the environment; `.env.example` lists every variable, including the ones Cognee reads itself (`LLM_*`, `EMBEDDING_*`). Embeddings run locally through fastembed; the first cognify downloads the model. Two settings belong to Related courses: `RELATED_COURSES_K`, how many nearest courses `/ask` also searches (`0` turns the lane off), and `COURSE_SUMMARY_REFRESH_S`, how often Course summaries are recomputed. Besides Note ingest, the API process runs that refresh on a timer, embedding one profile per ready Material with the same fastembed model and storing the mean per course in `course_summaries`; both loops sit under one file lock, hence one API process per Cognee root.

Identity is dev-only: with `DEV_HEADER_AUTH=true` the `X-User: <email>` header is the caller. Each email becomes one Cognee principal; materials are ingested as `INSTRUCTOR_EMAIL`.

The two default tests marked `canary` spend real LLM calls. `test_private_notes_never_leak` cognifies a Material and a Note, then asserts a second user's `/ask` never carries the first user's Note. `test_retrieved_instructions_do_not_override_grounded_answers` uses poisoned context and checks Graph, RAG and Hybrid answers, an unsupported question and a follow-up. Both require successful Cognify rather than passing on empty tiers. Without `LLM_API_KEY` they skip. Both passed locally on 20 Sep 2026; the repository secret is still pending (#14). The shared `workspace` fixture supplies an explicit per-test `CACHE_DB_URL` so Cognee cannot reuse a default SQL cache pointing at a deleted temporary root.

For reliably offline verification, use `uv run pytest -m "not canary"`, even if a key is configured. `tests/test_prompt_boundary.py` checks the actual Cognee prompt path with external storage/LLM substitutes, including escaped delimiters and session history. The current API has no `not_covered` field; unsupported generated answers are requested as "Not covered by the supplied materials." `CHUNKS` remains raw retrieval. See [security.md](../docs/wiki/security.md) for mitigation limits. Tests disable Cognee log-file rotation by default to avoid deleting user-level logs.

Layout: `lattice/main.py` builds the FastAPI app (`create_app`), `lattice/config.py` holds settings, and `lattice/engine.py` owns the Cognee seam with prompt adapters in `lattice/grounding.py`. `lattice/db/` holds SQLAlchemy models, repositories and session management; Alembic migrations live in `migrations/`. `lattice/retrieval.py` defines Tier results and Evidence without importing Cognee. RPC routers live in `lattice/api/`; `lattice/mcp.py` adapts shared study and Page Note operations for MCP. Embedded Cognee databases live under `.cognee/`, uploads under `data/uploads/`; both are ignored. See [components.md](../docs/wiki/components.md) and the [first-cut findings](../docs/research/cognee-1.5.4-first-cut-findings.md).

```sh
curl -H 'X-User: alice@example.com' -F course=cs101 -F file=@slides.pdf \
  localhost:8000/materials.upload
curl -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"course":"cs101","body_md":"hash tables are week 3"}' localhost:8000/notes.save
curl -H 'X-User: alice@example.com' -H 'content-type: application/json' \
  -d '{"course":"cs101","question":"what is a hash table?"}' localhost:8000/ask
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
"../.scratch/new-results.json"`; create the repository-root `.scratch/` directory first if absent.
Results are never overwritten. Keep raw outputs in this ignored directory; commit concise findings
and evidence links under `docs/research/`, not raw experiment dumps.
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
