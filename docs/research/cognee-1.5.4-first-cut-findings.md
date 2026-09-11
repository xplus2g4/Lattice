# Cognee 1.5.4: findings from the first runnable cut

> Point-in-time, 10 Sep 2026, against `cognee==1.5.4` on Python 3.14.6 with the embedded
> stack (SQLite, LanceDB, Ladybug). Observed by running `server/` against the library and by
> reading its source; not from docs alone unless marked. Feeds the go/no-go and the backlog
> issues in [backlog.md](../wiki/backlog.md); does not close them by itself.

## What the code says

**`search()` signature and `dataset_name` on results (backlog issue 1).**
`cognee.search(query_text, query_type, user, datasets=None, dataset_ids=None, session_id=None,
verbose=False, include_references=False, ...)`. Two things the architecture did not assume:

- `datasets=["name"]` resolves names only among datasets the calling principal *owns*. A
  student querying the instructor-owned `{course}-global` must pass `dataset_ids=[uuid]` or
  gets `DatasetNotFoundError` (documented in the `search` reference; confirmed in
  `get_authorized_existing_datasets`). The API therefore holds the global dataset's UUID and
  always sends `dataset_ids`.
- One call over N datasets runs N searches (`search_in_datasets_context` fans out with
  `asyncio.gather`) and returns **one completion per dataset**, not a fused answer. With
  backend access control on, each result is `{dataset_id, dataset_name, dataset_tenant_id,
  search_result}`; with `verbose=True` it is `{..., text_result, context_result,
  objects_result, evidence[]}`. "One `/ask` spans both tiers" therefore means one call, two
  answers. The fused answer has to be composed above Cognee (flows.md steps 6–8), which is
  the design anyway; the docs sentence "each hit carries `dataset_name`" is true per
  dataset, not per chunk.

**Backend access control default (backlog issue 2).** `ENABLE_BACKEND_ACCESS_CONTROL` is on
by default in 1.5.4 (startup banner: "Multi-user access control on by default"; README
table). Cognee raises rather than silently sharing when a backend cannot isolate. Observed
with two principals on the embedded stack: Bob passing Alice's private `dataset_id` gets
`PermissionDeniedError` ("does not have necessary permission: [read]"); by name he gets
`DatasetNotFoundError`; through `/ask` he only ever receives the course tier, and a
passphrase planted in Alice's note never appears in his answers. Cognee also records the
refused attempts in `pipeline_runs` with `outcome=failed, error_class=PermissionDeniedError`.
The canary test still needs writing, but the mechanism it will assert on works.

**Provenance on `add()` (backlog issue 3).** `add()` takes `DataItem(data, label,
external_metadata: dict, system_metadata, data_id)` and `node_set: list[str]`, so
material-level metadata (`material_id`, `week`, `lecture_no`) can be attached without
pre-conversion. Chunk-level provenance comes back through `search(include_references=True)`
as `EvidenceReference{kind, artifact_id, dataset_id, data_id, chunk_id, chunk_index,
document_name, ...}`. Observed for `GRAPH_COMPLETION`: `kind="segment"` entries carry
`document_name`, `chunk_index`, `chunk_id`, `data_id` (listed once per graph edge that
cites them, so dedupe on `artifact_id`), alongside `graph_node` (`label`) and `graph_edge`
(`relationship_name`) entries. Cognee also appends an "Evidence: chunk N of document X
(data_id, chunk_id)" line to the completion text itself. `CHUNKS` returns chunk dicts with
`text`, `document_id`, `document_name`, `chunk_index` and no evidence list. Whether
`chunk_index` maps to a slide/page for PDF/PPTX is still unobserved (only `.md` was
ingested). `.md` files are ingested with `extension="txt"`; `Data.name` is the file stem.

**Ontology (backlog issue 4).** Not exercised. `cognify()` takes `config:
cognee.modules.ontology.ontology_config.Config` and `graph_model: BaseModel`, so both
routes in the backlog exist as parameters.

**Cost per deck (backlog issue 5).** `pipeline_runs.tokens_in/tokens_out` records LLM usage
per operation (`add_pipeline`, `cognify_pipeline`, `search`), so the Worker can read
`materials.cognify_tokens` from there. Measured with DeepSeek V4 Flash on the prompted-JSON
path, default `KnowledgeGraph` model, no ontology:

| Operation | Input content | tokens_in | tokens_out | Wall time |
|---|---|---|---|---|
| cognify `week3.md` (245 tokens) | 1 chunk | 1,780 | 15,123 | 47 s |
| cognify note `n1` (49 tokens) | 1 chunk | 1,566 | 2,635 | 9 s |
| search `GRAPH_COMPLETION`, per dataset | — | 1,000–2,300 | 40–75 | 1.5–3.5 s |
| search `CHUNKS`, per dataset | — | 0 | 0 | < 0.1 s |

Output tokens dominate: 50–60x the source length for cognify. At DeepSeek's off-peak rate
($0.22/M in, $0.66/M out) the 245-token page cost about $0.01; peak doubles it. Extrapolating
linearly, a 40-slide deck of roughly 6,000 tokens lands at $0.25–0.50 per cognify, which is
the number to put against the per-material ceiling. A real deck should be measured before
trusting the linear extrapolation; chunking will change the per-chunk overhead.

## What ran

- Python 3.14 is inside Cognee's `>=3.10,<3.15`; `uv add "cognee[fastembed]==1.5.4"`
  resolved with the existing `pydantic-settings==2.15.0`.
- Principals: `create_user(email, password, is_verified=True)` / `get_user_by_email`. Two
  emails give two principal UUIDs. `@lattice.local` is rejected by pydantic's email
  validator (reserved TLD); the instructor principal is `instructor@lattice.example`.
- Datasets: `create_authorized_dataset(name, owner)` grants owner read/write/delete/share;
  `give_permission_on_dataset(user, dataset_id, "read")` is idempotent. Names may not
  contain `.` or space; `{course}-global` and `{course}-user-{uuid}` are accepted.
- Replace-by-name: adding the same file path with changed content creates a second
  `Data` row (dedup is by content hash, not name); `cognee.datasets.delete_data(dataset_id,
  data_id, user, mode="hard")` then `add` gives replace semantics.
- A second `Engine` on the same root resolves the same principals and dataset UUIDs, so
  the in-memory caches are safe across restarts.
- Fresh root needs `create_db_and_tables()` before any user call; `add()` also runs an LLM
  and embedding connection test on first use (`COGNEE_SKIP_CONNECTION_TEST=true` skips).
- LLM route: `LLM_PROVIDER=custom`, `LLM_ENDPOINT=https://api.deepseek.com/v1`. DeepSeek
  has no embeddings API, so embeddings are `EMBEDDING_PROVIDER=fastembed`,
  `BAAI/bge-small-en-v1.5`, 384 dimensions, in-process.
- `LLM_MODEL` must be `openai/deepseek-v4-flash`, not `deepseek/deepseek-v4-flash`.
  DeepSeek currently rejects `response_format: json_schema` with "This response_format type
  is unavailable now" while accepting `json_object`. LiteLLM's capability table says
  DeepSeek supports schemas, so Cognee's `litellm_native` adapter takes the schema path and
  re-raises (the demotion logic only triggers on errors containing "schema"). With the
  `openai/` prefix `litellm.supports_response_schema` is false and Cognee uses its
  prompted-JSON fallback, which works. Cost: LiteLLM's `response_cost` is `None` on that
  route; use `pipeline_runs` tokens instead.
- Cognify retries structured-output failures with exponential backoff (8, 16, 32, 64,
  128 s observed) before failing the pipeline, so a bad key or rejected format shows as
  several minutes of `cognifying` before `failed`.
- `session_id` on `search` with two datasets: the follow-up "which week is that from?"
  after a question about the note's Java fact answered "Week 3" from the course tier, so
  conversation context did carry across the two per-dataset searches in one session.

## Ecosystem facts that differ from the wiki

- The embedded graph store is **Ladybug** (`ladybug==0.19.0`), Kuzu's successor after the
  upstream archive. The wiki's Kuzu vs Neo4j question still stands but the pin is
  `ladybug`, not `kuzu`.
- Cognee's default `search` type is now `HYBRID_COMPLETION`; `GRAPH_COMPLETION` and
  `RAG_COMPLETION` remain available. `INSIGHTS` (named in flows.md for Phase 2) is not a
  `SearchType` in 1.5.4; the graph-facing members are `TRIPLET_COMPLETION`, `CYPHER`,
  `GRAPH_REPORT` and the `GRAPH_COMPLETION_*` variants. Phase 2 should pick from these.
- New top-level `remember / recall / forget / improve` wrap `add / cognify / search`;
  the V1 calls still work and are what `server/` uses.
