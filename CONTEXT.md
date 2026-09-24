# Course Knowledge Store

Per-course knowledge store built from official teaching materials and students' own notes, answering questions with citations and related concepts.

## Language

### Knowledge

**Tier**:
One of the two visibility levels knowledge lives in: the global tier (shared by everyone enrolled in a course) or the private tier (readable only by its owner).
_Avoid_: level, scope, layer

**Dataset**:
The engine's unit of storage and permissioning. Each course has one global dataset; each enrolled user has one private dataset per course. A tier is the product concept; a dataset is its concrete unit.
_Avoid_: collection, index, namespace

**Material**:
An official teaching artifact — slides, tutorial, or memo — uploaded by any enrolled user and belonging to the global tier.
_Avoid_: document, file, upload

**Page**:
The unit of a Material the reader shows and citations point to. Slides are pages; "slide" is acceptable in reader copy for decks.
_Avoid_: slide (outside reader copy), screen

**Note**:
A student's own text, or a PDF the student adds, belonging to that student's private tier for one course.
_Avoid_: annotation, document

**Cognify**:
The expensive indexing step that turns added content into searchable knowledge (chunks, embeddings, graph entities and relations).
_Avoid_: index, process, embed (as verbs for this step)

**Chunk**:
The smallest retrievable unit of indexed content; what citations resolve to. Every chunk carries provenance back to a Material page or a Note.

**Topic**:
A contiguous run of pages about one idea within a Material, produced at Cognify time. What "the topic the student just read" resolves to.
_Avoid_: unit, module, section, segment

### Identity

**Principal**:
The engine-side identity a call is made as. Derived from the app user, never from request input; each app user maps to exactly one principal.
_Avoid_: engine user, service account

**Enrolment**:
The link between a user and a course; grants read on the course's global dataset and creates the user's private dataset.
_Avoid_: membership, registration

### Answering

**Session**:
A user's conversation within one course. Never spans courses.
_Avoid_: chat, thread

**Turn**:
One user question or one assistant answer within a session; the unit of citation audit and cost accounting.
_Avoid_: message, exchange

**Citation**:
An answer's reference to a chunk the retrieval actually returned; anything unresolvable is dropped before reaching the client.
_Avoid_: source, reference

**Related concept**:
A concept surfaced alongside an answer, derived from graph structure (not the LLM) and only explained by the LLM.

### Quizzing

**Quiz**:
A set of generated questions plus the student's results, always grounded in one course's Materials.
_Avoid_: session, test, exam

**Pop quiz**:
A Quiz the assistant initiates on the Topic the student just read; at most three questions; skippable.

**Grill me**:
A Quiz the student initiates over a scope they choose; about ten questions; ends with a per-Topic summary.

### Concept graph (Phase 2)

**Concept**:
A named idea taught inside a Topic; the node type related concepts are drawn from. This feature is out of scope.

### System

**API**:
The identity-aware HTTP service: auth, RBAC, the ask pipeline, records. The only component that knows about users.

**Worker**:
The queue-consuming process that runs cognify and other ingest jobs. Same codebase as the API; never serves HTTP.

**Backend**:
The API and Worker together. Say API or Worker when you mean one of them.
_Avoid_: server, service (unqualified)

**Phase**:
A product feature milestone: Phase 1 is knowledge retrieval, Phase 2 is relation retrieval. Distinct from Stage.

**Stage**:
An engine implementation milestone: Stage 1 is Cognee-backed, Stage 2 is pgvector plus an own concept graph. Distinct from Phase.

**Approved / Rejected**:
The two outcomes of an evaluation, whether of a candidate engine or of an alternative in an ADR.
_Avoid_: go/no-go, go, no-go, greenlit
