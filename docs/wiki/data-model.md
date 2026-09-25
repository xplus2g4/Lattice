# Data model

App tables in Postgres, knowledge in Cognee datasets, and the provenance rules that make citations resolvable.

## Application tables (Postgres, owned by the API)

```
users            id, email, name, role(student|instructor|admin), notes_opt_out, cognee_principal_id, created_at
courses          id, code, name, term, owner_user_id, global_dataset_name
enrolments       user_id, course_id, role(student|instructor), user_dataset_name, created_at
materials        id, course_id, week, lecture_no, type(slides|tutorial|memo), title,
                 gcs_uri, sha256, status(queued|converting|cognifying|ready|failed),
                 error, created_by, created_at, updated_at
notes            id, user_id, course_id, material_id, page, body_md, filename, sha256, storage_uri, revision, cognified_revision,
                 ingest_attempts, run_after, status(dirty|indexing|ready|failed), error, created_at, updated_at
sessions         id, user_id, course_id, created_at
turns            id, session_id, role(user|assistant), content_json, cited_chunk_ids[], used_notes, latency_ms
feedback         turn_id, user_id, rating(+1|-1), comment
course_summaries course_id, summary_text, embedding vector(1536), embedding_model, source_digest, refreshed_at
spend            id, occurred_at, user_id?, course_id, turn_id?, material_id?, note_id?,
                 kind(completion|embedding), model, prompt_tokens, completion_tokens, cached_tokens,
                 usd numeric(12,6)?, request_id?
product_events   id, occurred_at, user_id, course_id?, name, properties jsonb
```

Rules:

- `materials.sha256` gives idempotent re-upload. Same hash is a no-op; a new hash for the same (course, week, title) replaces the content in Cognee, then updates the row.
- `course_summaries` holds one unit-length vector per course with a ready Material, refreshed on a timer ([flows.md](./flows.md)); `/ask` picks Related courses by cosine distance over it ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md)). The `vector` extension is enabled by the migration that creates the table; the width is pinned in the DDL.
- `turns.cited_chunk_ids` is the audit trail for citation validation (see [security.md](./security.md)) and for eval.
- `spend` is the Spend ledger: one row per provider attempt, completion or embedding, with the model name normalised (provider prefix stripped) and `usd` computed from the configured price table, null when the model has no price. Attribution follows the vocabulary: Turn Spend carries `user_id` and `turn_id` (the asking student, including the Related-course lane made on their behalf); Cognify Spend of a Material carries `course_id` and `material_id` with no user; a Note's carries its author and `note_id`; Course-summary embeddings carry only the course. Per-Turn and per-Material totals are `GROUP BY`, not columns, and `today_usd` (sum over `occurred_at` since midnight UTC) is what the Ceiling compares against. Indexed on `(occurred_at)` and `(course_id, occurred_at)`.
- `product_events` is the Product event store: one row per user action, written by the API inside the action's own transaction, attributed to a Principal (`user_id`) and usually a course. `name` is dotted (`ask.asked`, `quiz.submitted`, `page.opened`), `properties` holds ids, counts and lengths only; `ask.asked` stores `question_len` and `question_sha256`, never the text ([security.md](./security.md#egress)). Indexed on `(occurred_at)`, `(user_id, occurred_at)` and `(course_id, occurred_at)`.
- Note ingest and the Course-summary refresh are timer loops inside the API process polling the `notes` and `materials` rows themselves; there is no separate job table ([ADR 0003](../adr/0003-postgres-table-job-queue.md) describes the queue a Worker would use).

## Cognee datasets and permissions

Cognee's unit of scope is the dataset. The two knowledge tiers map to two dataset families ([ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md)):

| Dataset | Name pattern | Created when | Read | Write |
|---|---|---|---|---|
| Course global | `{course_code}-global` | Course created | Every enrolled principal | Instructors of that course, admin |
| User private | `{course_code}-user-{user_id}` | User enrols in the course | Owner only | Owner only |

`ENABLE_BACKEND_ACCESS_CONTROL=true`, so each principal+dataset pair is isolated at the vector and graph level rather than only filtered in application code. Every `cognee.add/cognify/search` call passes the caller's principal; the API never uses a super-user principal on a user's request path. The one call made as another principal is the Related-course lane of `/ask`, which searches other courses' global datasets as the instructor principal: that principal owns every global dataset and no private one, and the lane's own datasets map is checked by `IsolationError` ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md)).

The mapping from app user to Cognee principal is stored in `users.cognee_principal_id` and created lazily on first enrolment. Deleting an account deletes every `{course}-user-{id}` dataset before the row.

## Concept ontology (Phase 2)

Cognify runs against a small course ontology so the graph carries edges the product can explain, rather than arbitrary extracted relations:

```
Topic        — a syllabus unit (usually a week or lecture)
Concept      — a named idea taught inside a Topic
edges:
  Concept  prerequisite_of  Concept
  Concept  builds_on        Concept
  Concept  related_to       Concept
  Concept  introduced_in    Topic        (property: week)
  Chunk    mentions         Concept
```

This is the target product model, not the current API's extraction configuration. The [20 Sep probe](../research/2026-09-20-cognee-ontology-findings.md) exercised both OWL/RDF and a constrained Pydantic `KnowledgeGraph` subclass. In that storage path, Concepts and Topics are `Entity` nodes classified by `is_a` links to `EntityType`; Chunk links are `contains`, not literal `mentions`. The recommended prototype uses a constrained Pydantic schema plus semantic validation and dataset-scoped Cypher. OWL strict mode does not enforce relationship names or domain/range constraints. Production adoption and quality evaluation remain in [backlog.md](./backlog.md). The intended ontology is per course and versioned with the course (`courses.ontology_version`, added when it exists).

## Chunk provenance

The target is for every global-tier Chunk to carry `material_id`, `week`, `lecture_no`, and `page`/`slide`, and private-tier Chunks to carry `note_id`. [The real-PDF probe](../research/2026-09-20-cognee-material-provenance-cost.md) verified Material-level metadata attachment and Chunk evidence, but not structured page attribution: 40 PDF pages became two Chunks, and one page crossed their boundary. `chunk_index` is an ordinal, not a page number. Pre-converting the whole Material to Markdown with page headers still merges pages. Reliable citation locations need page-aware partitioning that propagates page metadata to each Chunk, or validated offset mappings. That ingest change remains unimplemented. The [PPTX follow-up](../research/2026-09-20-cognee-pptx-provenance.md) found no native loader in the current dependency set; pre-converted slide text works but has the same multi-slide Chunk limitation. The conversion must also preserve the original-Material mapping.
