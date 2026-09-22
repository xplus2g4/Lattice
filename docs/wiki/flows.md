# Key flows

The flows that move data through the system: enrol, remove a course, ingest a Material, save a Note, ask, and ask with related concepts.

## Enrol

1. User signs in with Google; web gets a session; the API verifies the JWT on every call.
2. User enters a course code, creating an `enrolments` row.
3. If `users.cognee_principal_id` is null, create the Cognee principal.
4. Create the `{course}-user-{id}` dataset; grant owner read-write; grant read on `{course}-global`.

Nothing is cognified here. Enrolment is cheap and synchronous.

## Remove a course

The home course card offers **Remove course** to the owner or an admin. Its confirmation says “All your notes and materials will be gone!” and explains that removal affects everyone enrolled. `/courses.delete` checks ownership, pauses ingest until active work finishes, removes the course's global and private Datasets (including former enrollees), removes its stored Materials and Notes, and cascades deletion through its application records. Failed cleanup returns an error and leaves the course available for retry. After success the browser clears the course bookmark, saved Session selection, and matching reading shortcut.

This differs from `/enrolments.leave`, which retains Notes and the private Dataset. Legacy browser-only course entries are registered and joined when the student explicitly uploads a Material; only a missing-course response triggers that recovery.

After confirmation, the dialog closes immediately and the course card shows “Removing…” while the request completes. Other courses remain usable. Progress and failures live in the app's shared mutation cache, so navigating within the app does not interrupt removal; failures appear on the card with **Retry removal**. A full browser reload does not preserve this in-memory progress indicator.

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

Same shape as material ingest, with `kind=index_note`, dataset `{course}-user-{id}`, and the user's own principal. Saves are debounced client-side and coalesced in the queue (one pending job per note) so typing does not burn tokens. `notes.status` shows `indexing` until done; answers use whatever is indexed.

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
  6. build CONTEXT blocks tagged [source: course|notes] [week, slide]; wrap as data
  7. LLM → structured Answer {answer_md, confidence, not_covered, citations[], related[], used_notes}
  8. validate: drop citations whose chunk_id ∉ hits; strip HTML/links; set used_notes from provenance
  9. persist turn (cited_chunk_ids, cost, latency); stream answer_md to client; send citations + related as a trailing frame
```

Cross-dataset `search()` does honour permissions, so `ASK_TWO_CALL_MODE` stays off ([findings](../research/cognee-1.5.4-first-cut-findings.md); backlog issues 1 and 2 are closed). It remains the fallback: setting `ASK_TWO_CALL_MODE=1` makes step 5 two calls, global then private, merged in the API. The contract of `/ask` is unchanged either way.

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
