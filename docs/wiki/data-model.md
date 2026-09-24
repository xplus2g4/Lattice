# Data model

App tables in Postgres, knowledge in Cognee datasets, and the provenance rules that make citations resolvable.

## Application tables (Postgres, owned by the API)

```
users            id, email, name, role(student|instructor|admin), notes_opt_out, cognee_principal_id, created_at
courses          id, code, name, term, owner_user_id, global_dataset_name
enrolments       user_id, course_id, role(student|instructor), user_dataset_name, created_at
materials        id, course_id, week, lecture_no, type(slides|tutorial|memo), title,
                 gcs_uri, sha256, status(queued|converting|cognifying|ready|failed),
                 error, cognify_tokens, cognify_cost_usd, created_by, created_at, updated_at
notes            id, user_id, course_id, title, body_md, status(dirty|indexing|ready), updated_at
sessions         id, user_id, course_id, created_at
turns            id, session_id, role(user|assistant), content_json, cited_chunk_ids[], used_notes, latency_ms, cost_usd
feedback         turn_id, user_id, rating(+1|-1), comment
jobs             id, kind(ingest_material|index_note|reindex_course), payload_json, status, attempts, run_after, locked_by
eval_runs        id, git_sha, model, prompt_version, search_type, metrics_json, created_at
```

Rules:

- `materials.sha256` gives idempotent re-upload. Same hash is a no-op; a new hash for the same (course, week, title) replaces the content in Cognee, then updates the row.
- `turns.cited_chunk_ids` is the audit trail for citation validation (see [security.md](./security.md)) and for eval.
- The job queue is a Postgres table with `SELECT … FOR UPDATE SKIP LOCKED`. No Redis, no Celery ([ADR 0003](../adr/0003-postgres-table-job-queue.md)).

## Cognee datasets and permissions

Cognee's unit of scope is the dataset. The two knowledge tiers map to two dataset families ([ADR 0002](../adr/0002-two-tier-datasets-double-isolation.md)):

| Dataset | Name pattern | Created when | Read | Write |
|---|---|---|---|---|
| Course global | `{course_code}-global` | Course created | Every enrolled principal | Instructors of that course, admin |
| User private | `{course_code}-user-{user_id}` | User enrols in the course | Owner only | Owner only |

`ENABLE_BACKEND_ACCESS_CONTROL=true`, so each principal+dataset pair is isolated at the vector and graph level rather than only filtered in application code. Every `cognee.add/cognify/search` call passes the caller's principal; the API never uses a super-user principal on a user's request path.

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
