# Key flows

The six flows that move data through the system: enrol, ingest a material, save a note, ask, refresh Course summaries, and ask with related concepts.

## Enrol

1. User signs in with Google; web gets a session; the API verifies the JWT on every call.
2. User enters a course code, creating an `enrolments` row.
3. If `users.cognee_principal_id` is null, create the Cognee principal.
4. Create the `{course}-user-{id}` dataset; grant owner read-write; grant read on `{course}-global`.

Nothing is cognified here. Enrolment is cheap and synchronous.

## Ingest a course material (instructor)

```
web ──POST /materials (metadata)──▶ api ──▶ materials(status=queued), signed GCS PUT URL
web ──PUT file──▶ GCS
web ──POST /materials/{id}/complete──▶ api ──▶ jobs(kind=ingest_material)

worker: claim job
  ├─ fetch from GCS; verify sha256
  ├─ [optional] pre-convert PPTX/PDF → markdown with page headers   (status=converting)
  ├─ cognee.add(content, dataset_name=f"{course}-global", user=instructor_principal, metadata=…)
  ├─ cognee.cognify(datasets=[…], user=instructor_principal, ontology=course_ontology)   (status=cognifying)
  ├─ record tokens + cost from the LLM client
  └─ status=ready | failed(error)
```

Cognify is the expensive step (LLM extraction per chunk). It runs only in the Worker, with retries and a per-material cost ceiling. The UI polls `materials.status`.

## Save a note (student)

Same shape as material ingest, with `kind=index_note`, dataset `{course}-user-{id}`, and the user's own principal. Saves are debounced client-side and coalesced in the queue (one pending job per note) so typing does not burn tokens. `notes.status` shows `indexing` until done; answers use whatever is indexed. `/notes.upload` makes one Note per PDF; ingest hands the stored PDF to the engine's own loader instead of writing a `.md`.

## Ask (Phase 1)

```
POST /ask {course, session_id, question}
  1. authz: user enrolled in course; rate limit; daily token budget
  2. datasets = [f"{course}-global"] + ([f"{course}-user-{id}"] if not user.notes_opt_out)
  3. (multi-turn) rewrite question with last N turns using a small model
  4. cache check: (course, normalised_question) — only when datasets == [global]
  5. hits = cognee.search(query_text, query_type=RAG_COMPLETION | GRAPH_COMPLETION,
                          dataset_ids=[…], user=principal, include_references=True)
     - one call spans both tiers, but Cognee fans out per dataset and returns one
       completion per dataset, not a fused answer; dataset_id → tier
     - dataset_ids, not names: a name resolves only among datasets the caller owns, so a
       student cannot reach the instructor-owned {course}-global by name
  5a. related = the RELATED_COURSES_K courses nearest by Course summary (course_summaries,
      cosine distance, at least MIN_SIMILARITY=0.75 similar: a hard-coded guess, see
      backlog.md; none when this course has no summary yet). For each, one more
      cognee.search, concurrently with step 5, as the instructor principal over that
      course's {code}-global alone, with a datasets map of its own so an IsolationError
      refuses anything else, and under RELATED_POLICY (grounding.py): at most three
      one-sentence bullet points, each opening with its key term in bold, since it is
      reference material beside the answer. Results
      carry tier=related and course=code; segment evidence has document_name resolved to
      the Material's filename, since the client cannot list another course's Materials, and
      the client links each reference to that course's reader in a new tab. A related
      course that declines is dropped. The transcript text stays the course's own answer.
  6. build CONTEXT blocks tagged [source: course|notes] [week, slide]; wrap as data
  7. LLM → structured Answer {answer_md, confidence, not_covered, citations[], related[], used_notes}
  8. validate: drop citations whose chunk_id ∉ hits; strip HTML/links; set used_notes from provenance
  9. persist turn (cited_chunk_ids, cost, latency); stream answer_md to client; send citations + related as a trailing frame
```

Cross-dataset `search()` does honour permissions, so `ASK_TWO_CALL_MODE` stays off ([findings](../research/cognee-1.5.4-first-cut-findings.md); backlog issues 1 and 2 are closed). It remains the fallback: setting `ASK_TWO_CALL_MODE=1` makes step 5 two calls, global then private, merged in the API. The contract of `/ask` is unchanged either way.

## Refresh Course summaries

A timer in the API process (`COURSE_SUMMARY_REFRESH_S`, default one hour, first pass at start-up, under the same lock as Note ingest so one process runs it) recomputes the summary of every course whose ready Materials or embedding model changed:

```
for each course:
  ready = Materials with status=ready            (none → drop the course's row; never a Related course)
  digest = sha256 over (sha256, title, week, kind, Topic labels) of every ready Material
  unchanged digest and model → skip
  profile per Material = title, week, kind, Topic labels, first Page's text (pypdf), ≤ 1,500 chars
  vectors = the embedding model Cognify uses over the profiles; no LLM call
  course_summaries ⟵ unit-length mean of the vectors, the profiles, the model name, the digest
```

Per Material rather than one long text, so a course's later Materials are not crowded out of the vector ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md)).

## Ask with related concepts (Phase 2)

Extends the ask flow between steps 7 and 8:

```
  7a. concepts = Concept nodes mentioned by the cited chunks (from the graph, not the LLM)
  7b. neighbours = 1–2 hop traversal over prerequisite_of / builds_on / related_to,
                   excluding concepts already in the answer   (TRIPLET_COMPLETION, CYPHER
                   or a direct graph query; INSIGHTS is not a SearchType in 1.5.4)
  7c. rank by similarity to the question; dedupe; cap at 3–5
  7d. for each: one-line "why" from a small model; week + material deep link from introduced_in
  → Answer.related[]
```

Related concepts are derived from graph structure and only explained by the LLM. That keeps them stable across runs and makes precision@3 measurable in eval.
