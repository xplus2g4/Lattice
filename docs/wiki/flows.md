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

## Quiz frontend (current)

The persistent sidebar has five tabs: **Homepage**, **Materials**, **Notes**, **Ask**, and **Practice**. It stays visible on the homepage, course pages, reader, and Practice, with a compact rail on smaller screens. Homepage always opens the overview of all courses. The course selector remembers the user's active course and keeps the current tab when switching courses. Materials, Notes, and Ask reuse the same product panels as the reader; the older duplicate screens have been removed, with existing URLs retained. Ask Session links still open their saved conversation.

**Practice** opens `/courses/$course/quizzes`; there is no separate top-right Grill me shortcut. The setup shows ready Materials and their Topics. Starting a new Quiz is explicitly unavailable until question generation exists; the frontend does not create sample questions or invent grades. Automatic Pop quiz prompts are also pending generation and trigger support.

The study layout follows the supplied Quiz designs: a course rail, lavender practice area, and an Ask panel (a sheet on smaller screens). Scope controls offer the current Page, a Page range, Topics, or the whole Material. The reader's selected Material is carried into setup. Grill me shows all questions on an answer sheet; Pop quiz shows one question at a time. Drafts are kept as the student types, but saving answers to the API remains explicit because each write currently creates an attempt. The Ask panel retains its existing course-wide retrieval behavior; it does not claim to restrict answers to the selected Material or provide hints only. Topic result cards use recorded correctness: all correct is Strong, mixed results Developing, all incorrect Revisit, and ungraded or incomplete results remain labeled as such.

Existing Quiz records can be opened from the in-progress list or a `?quiz=<id>` link. The frontend checks the Quiz belongs to the URL's course. Multiple-choice and short answers are saved through `/quizAnswers.record` without correctness or feedback supplied by the browser. Saved progress survives reload; unsaved drafts stay in sessionStorage, keyed by user, course, Quiz and question. Failed saves retain drafts and offer a reload of saved answers. The records API has no idempotency key, so a request whose response is lost should be reconciled before saving another attempt.

Finishing requires every answer to be saved, then calls `/quizzes.submit` without a fabricated score. A confirmed early end calls `/quizzes.abandon`; both remain in Quiz history. Review displays the recorded score and latest answer feedback, a per-Topic summary that separates ungraded and unanswered questions, and links to associated Materials. Topic counts on this screen describe this Quiz's latest attempts, rather than the cumulative `/quizStats.byTopic` counts. Grading and a structured Citation contract remain backend integration work.

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
