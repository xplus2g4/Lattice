# Related courses: the three nearest courses' Materials answer beside the course's own

Decided 2026-09-24. A question asked in one course is also answered from the global tier of the three courses whose Materials are nearest to it, so a student in one course sees what a related course's slides say about the same idea. Nearness comes from `course_summaries` in the app Postgres (pgvector): one unit-length vector per course, the mean of one embedding per ready Material (title, week, kind, Topic labels and the first Page's text), computed with the embedding model Cognify uses ([ADR 0007](./0007-openai-embeddings.md)) and refreshed by a timer in the API process, with no LLM call. The Session still belongs to one course; only retrieval reaches further. The related lane runs as the instructor principal, which owns every global dataset and no private one, under a datasets map of its own so `IsolationError` refuses anything else; Cognee permissions are untouched, so what a student principal may read is still exactly their Enrolments.

## Considered options

- **Grant the student read on the related datasets at ask time.** One search call instead of several, but Cognee permissions would stop mirroring Enrolments, and "what can this principal read" would no longer be answerable from the app tables. Rejected.
- **Cognee's per-dataset `GlobalContextSummary` (the memify global context index).** An LLM pass per refresh, stored in Cognee's vector store under dataset permissions, and it would tie the recommender to the engine Stage 2 replaces. Rejected.
- **One LLM-written abstract per course, embedded once.** Explainable and inside the model's window, at a paid call per refresh and a prompt to maintain. Deferred: the first change to make if the related courses look wrong.
- **Chunk references from the related courses with no completion.** Free and instant, but the related Materials would then not inform the answer, which was the ask. Rejected.

## Consequences

- The architecture's "no cross-course queries" line is gone: a Session never spans courses, retrieval does.
- A course's global tier is now readable, through answers, by students not enrolled in it. Enrolment is already self-service by code, so nothing was private before; the citations still cannot open the reader for a course the student is not in.
- Cost per ask rises from two completions to five at the default `RELATED_COURSES_K=3`; `0` turns the lane off. Latency stays near the slowest lane, since the searches run concurrently.
- The similarity floor is a magic number: `MIN_SIMILARITY = 0.75` cosine similarity in `server/lattice/db/repo/course_summaries.py`, a guess made on 2026-09-24 for mean-pooled Course summary vectors without any measurement, there so that with few courses the three nearest are not unrelated ones. Measure it against a real course set before trusting it; [backlog.md](../wiki/backlog.md) carries the open question.
- One profile per Material pooled into a mean rather than one long summary, so a course's later Materials are not crowded out of the vector. The `vector(1536)` DDL pins the width to `text-embedding-3-small`; another model needs a migration.
