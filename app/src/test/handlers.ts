import { HttpResponse, delay, http } from 'msw'

import type {
  Grill,
  GrillResult,
  Material,
  Note,
  Session,
  Turn,
} from '#/lib/api'
import type {
  CourseOut,
  GradedQuizOut,
  GrillPlanOut,
  MaterialOut,
  NoteOut,
  NoteUploadOut,
  QuizOut,
  QuizQuestionOut,
  SessionOut,
  TurnOut,
  UploadOut,
} from '#/lib/generated'
import {
  GRILL_BATCHES,
  assistantTurn,
  grill,
  session,
  userTurn,
} from './fixtures'

// Mocking happens at the HTTP boundary, never at `src/lib/api.ts`: the transport, the
// `X-User` header and the error flattening are behaviour under test, not scaffolding.
//
// The store is small but real, so a test can say "upload, then the list shows it" through
// the UI instead of asserting that a request was made.
export interface Store {
  materials: Array<Material>
  notes: Array<Note>
  // Partial, because a lookup by id can miss and the 404 path depends on saying so.
  sessions: Partial<Record<string, Session>>
  // `written` is the batches `quizzes.extend` has served; only their questions are on
  // the wire, the rest wait in the fixture the way unwritten batches wait on the server.
  grills: Partial<
    Record<string, { grill: Grill; course: string; written: Array<number> }>
  >
}
export const store: Store = {
  materials: [],
  notes: [],
  sessions: {},
  grills: {},
}
let nextAnswer: Turn | null = null
let nextAnswerAfterMs = 0
let nextNote = 1
let nextGrill: Grill | null = null
let nextGraded: GrillResult | null = null
let batchDelays: Partial<Record<number, number>> = {}
let batchFailures: Partial<Record<number, number>> = {}

/** Shape the next answer without replacing the handler, which would skip the session
 * bookkeeping the client depends on and leave `/ask` returning an id nothing can read.
 * `after` holds the answer back, so a test can look at the panel while it is asking. */
export function answerNextAskWith(turn: Turn, { after = 0 } = {}) {
  nextAnswer = turn
  nextAnswerAfterMs = after
}
/** The Grill the next `quizzes.generate` writes, in place of the fixture. */
export function grillNextWith(next: Grill) {
  nextGrill = next
}
/** What the next `quizzes.grade` returns, in place of grading against the fixture's key. */
export function gradeNextGrillWith(result: GrillResult) {
  nextGraded = result
}
/** Holds one batch back, so a test can look at the form while it is still being written. */
export function holdBatch(index: number, ms: number) {
  batchDelays[index] = ms
}
/** Makes the next `times` requests for one batch fail with a 502. */
export function failBatch(index: number, times = 1) {
  batchFailures[index] = times
}
export function resetStore(next: Partial<Store> = {}) {
  store.materials = next.materials ?? []
  store.notes = next.notes ?? []
  store.sessions = next.sessions ?? {}
  store.grills = next.grills ?? {}
  nextAnswer = null
  nextAnswerAfterMs = 0
  nextNote = 1
  nextGrill = null
  nextGraded = null
  batchDelays = {}
  batchFailures = {}
}
function idFor(value: string): string {
  let hash = 2166136261
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return `${hex}-0000-4000-8000-000000000000`
}
function courseOut(code: string): CourseOut {
  return {
    id: idFor(code),
    code,
    name: code.toUpperCase(),
    term: null,
    owner_user_id: idFor('owner'),
    global_dataset_name: `${code}-global`,
    created_at: '2026-01-01T00:00:00Z',
  }
}
function materialOut(m: Material): MaterialOut {
  return {
    id: m.id,
    course_id: idFor(m.course),
    title: m.filename,
    filename: m.filename,
    week: null,
    lecture_no: null,
    kind: null,
    page_count: null,
    sha256: m.sha256,
    status: m.status,
    error: m.error,
    created_by: idFor('owner'),
    created_at: m.created_at,
    updated_at: m.updated_at,
  }
}
function noteOut(n: Note): NoteOut {
  return {
    id: n.id,
    course_id: idFor(n.course),
    material_id: null,
    page: null,
    body_md: n.body_md,
    filename: n.filename,
    sha256: n.sha256,
    revision: 1,
    cognified_revision: n.status === 'ready' ? 1 : 0,
    status:
      n.status === 'queued'
        ? 'dirty'
        : n.status === 'cognifying'
          ? 'indexing'
          : n.status,
    error: n.error,
    created_at: n.updated_at,
    updated_at: n.updated_at,
  }
}
function turnOut(t: Turn, sessionId: string): TurnOut {
  return {
    id: t.id ?? idFor(t.content),
    session_id: sessionId,
    role: t.role,
    content_json: {
      text: t.content,
      query_type: t.query_type,
      results: t.results.map((r) => ({
        tier:
          r.tier === 'global'
            ? 'course'
            : r.tier === 'private'
              ? 'notes'
              : 'related',
        dataset_name: r.tier,
        course: r.course,
        answer: r.answer,
        evidence: r.citations.map((c) => ({
          kind:
            c.kind === 'chunk'
              ? 'segment'
              : c.kind === 'relation'
                ? 'graph_edge'
                : c.kind,
          document_name: c.filename,
          chunk_index: c.chunk_index,
          chunk_id: c.chunk_id ?? null,
          page_start: c.page_start ?? null,
          page_end: c.page_end ?? null,
          relationship_name: c.relation,
          label: c.label,
        })),
      })),
    },
    cited_chunk_ids: [],
    used_notes: t.used_notes,
    latency_ms: t.latency_ms,
    created_at: t.created_at,
  }
}
function sessionOut(s: Session): SessionOut {
  return {
    id: s.id,
    course_id: idFor(s.course),
    created_at: s.created_at,
    last_turn_at: s.turns.at(-1)?.created_at ?? s.created_at,
    turns: s.turns.map((t) => turnOut(t, s.id)),
  }
}
const AT = '2026-01-01T00:00:00.000Z'
function batchOf(q: { position: number }) {
  return Math.floor(q.position / 100)
}
function questionOut(
  g: Grill,
  q: Grill['questions'][number],
  withhold: boolean,
): QuizQuestionOut {
  return {
    id: q.id,
    quiz_id: g.id,
    topic_id: null,
    material_id: g.material_id,
    position: q.position,
    kind: q.kind,
    prompt: q.prompt,
    options_json: q.options,
    // The server withholds the key while the Quiz is open (schemas.quiz_out).
    expected_json:
      withhold || !q.key
        ? null
        : { answer: q.key.answer, explanation: q.key.explanation },
    citation_json: q.page === null ? null : { page: q.page },
    answers: q.given
      ? [
          {
            id: `${q.id}-a1`,
            question_id: q.id,
            attempt_no: 1,
            answer_text: q.given.text,
            correct: q.given.correct,
            feedback_json:
              q.given.reason === null ? null : { reason: q.given.reason },
            created_at: AT,
          },
        ]
      : [],
  }
}
function quizOut(g: Grill, course: string, written: Array<number>): QuizOut {
  return {
    id: g.id,
    course_id: idFor(course),
    kind: 'grill',
    scope_json: {
      material_id: g.material_id,
      page_start: g.page_start,
      page_end: g.page_end,
      topic_label: g.topic_label,
    },
    status: g.status,
    score: g.score,
    created_at: AT,
    submitted_at: g.status === 'open' ? null : AT,
    questions: g.questions
      .filter((q) => written.includes(batchOf(q)))
      .sort((a, b) => a.position - b.position)
      .map((q) => questionOut(g, q, g.status === 'open')),
  }
}
/** Grades the way the server does in spirit: an mcq by comparison, a short answer by
 * whether it mentions the model answer's key word, so a test can steer the verdict. */
function gradeAgainstKey(
  g: Grill,
  answers: Array<{ question: string; answer_text: string }>,
): GrillResult {
  const given = new Map(answers.map((a) => [a.question, a.answer_text]))
  const questions = g.questions.map((q) => {
    const text = given.get(q.id) ?? ''
    const correct =
      q.kind === 'mcq'
        ? text.trim().toLowerCase() === q.key?.answer.toLowerCase()
        : /bucket/i.test(text)
    return {
      ...q,
      given: {
        text,
        correct,
        reason: correct
          ? 'Correct.'
          : q.kind === 'mcq'
            ? `The correct option is: ${q.key?.answer}`
            : 'A collision is about two keys sharing a bucket.',
      },
    }
  })
  const right = questions.filter((q) => q.given.correct).length
  return {
    grill: {
      ...g,
      status: 'submitted',
      score: right / questions.length,
      questions,
    },
    remark:
      right === questions.length
        ? ''
        : 'Re-read p. 3 on hash collisions before moving on.',
  }
}
function scope(request: Request) {
  return new URL(request.url).searchParams.get('course') ?? ''
}

// Paths are matched without an origin so a developer's VITE_API_URL cannot break the run.
export const handlers = [
  http.get('*/courses.list', () => HttpResponse.json([])),
  http.get('*/courses.get', ({ request }) =>
    HttpResponse.json(courseOut(scope(request))),
  ),
  http.post('*/enrolments.join', () => HttpResponse.json({})),
  http.post('*/courses.create', async ({ request }) => {
    const body = (await request.json()) as { code: string }
    return HttpResponse.json(courseOut(body.code), { status: 201 })
  }),
  http.get('*/materials.list', ({ request }) =>
    HttpResponse.json(
      store.materials
        .filter((m) => m.course === scope(request))
        .map(materialOut),
    ),
  ),
  http.post('*/materials.upload', async ({ request }) => {
    // Read the filename out of the raw multipart body rather than calling
    // `request.formData()`. jsdom's `File` is not Node's, and undici's parser rejects it
    // outright, so the parse would throw before any handler logic ran.
    const body = await request.text()
    const filename = /filename="([^"]*)"/.exec(body)?.[1]
    const course = /name="course"\r?\n\r?\n([^\r\n]+)/.exec(body)?.[1] ?? ''
    const at = new Date().toISOString()
    const created: Material = {
      id: idFor(`${course}:${filename}`),
      course,
      filename: filename || 'unknown',
      sha256: '0'.repeat(64),
      status: 'queued',
      error: null,
      created_at: at,
      updated_at: at,
    }
    store.materials = [
      ...store.materials.filter(
        (m) => !(m.course === course && m.filename === created.filename),
      ),
      created,
    ]
    const result: UploadOut = {
      material: materialOut(created),
      deduplicated: false,
    }
    return HttpResponse.json(result, { status: 202 })
  }),
  http.get(
    '*/materials.download',
    () =>
      // Markdown, so a `.md` Material has something to render.
      new HttpResponse('# Sample memo\n\nsample material', {
        headers: { 'Content-Type': 'text/plain' },
      }),
  ),
  http.get('*/notes.list', ({ request }) =>
    HttpResponse.json(
      store.notes
        .filter(
          (n) =>
            n.course === scope(request) &&
            n.owner === request.headers.get('X-User'),
        )
        .map(noteOut),
    ),
  ),
  http.get('*/notes.download', ({ request }) => {
    const id = new URL(request.url).searchParams.get('note')
    const found = store.notes.find(
      (n) => n.id === id && n.owner === request.headers.get('X-User'),
    )
    return found?.filename
      ? new HttpResponse('sample note', {
          headers: { 'Content-Type': 'application/pdf' },
        })
      : HttpResponse.json({ detail: 'no such note' }, { status: 404 })
  }),
  http.post('*/notes.save', async ({ request }) => {
    const body = (await request.json()) as {
      course: string
      note?: string
      body_md: string
    }
    const saved: Note = {
      course: body.course,
      owner: request.headers.get('X-User') ?? '',
      id: body.note ?? idFor(`note-${nextNote++}`),
      body_md: body.body_md,
      filename: null,
      sha256: null,
      status: 'queued',
      error: null,
      updated_at: new Date().toISOString(),
    }
    store.notes = [
      ...store.notes.filter(
        (n) =>
          !(
            n.course === saved.course &&
            n.owner === saved.owner &&
            n.id === saved.id
          ),
      ),
      saved,
    ]
    return HttpResponse.json(noteOut(saved), { status: 202 })
  }),
  http.post('*/notes.upload', async ({ request }) => {
    // Raw multipart text for the same reason as materials.upload: jsdom's File breaks
    // undici's parser.
    const body = await request.text()
    const filename = /filename="([^"]*)"/.exec(body)?.[1] ?? 'unknown'
    const course = /name="course"\r?\n\r?\n([^\r\n]+)/.exec(body)?.[1] ?? ''
    const saved: Note = {
      course,
      owner: request.headers.get('X-User') ?? '',
      id: idFor(`note-${nextNote++}`),
      body_md: '',
      filename,
      sha256: idFor(filename).replace(/-/g, '').padEnd(64, '0'),
      status: 'queued',
      error: null,
      updated_at: new Date().toISOString(),
    }
    store.notes = [...store.notes, saved]
    const result: NoteUploadOut = { note: noteOut(saved), deduplicated: false }
    return HttpResponse.json(result, { status: 202 })
  }),
  http.post('*/ask', async ({ request }) => {
    const body = (await request.json()) as {
      course: string
      question: string
      query_type?: string
      session?: string | null
    }
    const owner = request.headers.get('X-User') ?? ''
    const existing = body.session ? store.sessions[body.session] : undefined
    if (
      existing &&
      (existing.owner !== owner || existing.course !== body.course)
    ) {
      return HttpResponse.json({ detail: 'no such session' }, { status: 404 })
    }
    const current =
      existing ??
      session({ id: body.session ?? 'sess-1', course: body.course, owner })
    const answered = nextAnswer ?? {
      ...assistantTurn({ query_type: body.query_type ?? null }),
      id: `turn-${current.turns.length + 2}`,
    }
    // The API stores the question as its own turn before the answer (ask.py), so the
    // session read back after an ask contains both. Dropping the question here would
    // make the client's optimistic echo look correct when it is not.
    store.sessions[current.id] = {
      ...current,
      turns: [...current.turns, userTurn(body.question), answered],
    }
    nextAnswer = null
    if (nextAnswerAfterMs > 0) await delay(nextAnswerAfterMs)
    nextAnswerAfterMs = 0
    return HttpResponse.json({
      session: current.id,
      turn: turnOut(answered, current.id),
    })
  }),
  http.post('*/quizzes.generate', async ({ request }) => {
    const body = (await request.json()) as { course: string; material: string }
    const planned: Grill = {
      ...(nextGrill ?? grill()),
      material_id: body.material,
      page_start: 1,
      page_end: GRILL_BATCHES.at(-1)?.page_end ?? 1,
    }
    nextGrill = null
    store.grills[planned.id] = {
      grill: planned,
      course: body.course,
      written: [],
    }
    const out: GrillPlanOut = {
      quiz: quizOut(planned, body.course, []),
      batches: GRILL_BATCHES,
    }
    return HttpResponse.json(out, { status: 201 })
  }),
  http.post('*/quizzes.extend', async ({ request }) => {
    const body = (await request.json()) as { quiz: string; batch: number }
    const found = store.grills[body.quiz]
    if (!found)
      return HttpResponse.json({ detail: 'no such quiz' }, { status: 404 })
    if (found.grill.status !== 'open')
      return HttpResponse.json(
        { detail: `quiz already ${found.grill.status}` },
        { status: 409 },
      )
    const wait = batchDelays[body.batch] ?? 0
    if (wait > 0) await delay(wait)
    const failures = batchFailures[body.batch] ?? 0
    if (failures > 0) {
      batchFailures[body.batch] = failures - 1
      return HttpResponse.json(
        { detail: 'Questions could not be written; please retry' },
        { status: 502 },
      )
    }
    if (!found.written.includes(body.batch)) found.written.push(body.batch)
    const rows: Array<QuizQuestionOut> = found.grill.questions
      .filter((q) => batchOf(q) === body.batch)
      .map((q) => questionOut(found.grill, q, true))
    return HttpResponse.json(rows)
  }),
  http.post('*/quizzes.grade', async ({ request }) => {
    const body = (await request.json()) as {
      quiz: string
      answers: Array<{ question: string; answer_text: string }>
    }
    const found = store.grills[body.quiz]
    if (!found)
      return HttpResponse.json({ detail: 'no such quiz' }, { status: 404 })
    if (found.grill.status !== 'open')
      return HttpResponse.json(
        { detail: `quiz already ${found.grill.status}` },
        { status: 409 },
      )
    const asked: Grill = {
      ...found.grill,
      questions: found.grill.questions.filter((q) =>
        found.written.includes(batchOf(q)),
      ),
    }
    const result = nextGraded ?? gradeAgainstKey(asked, body.answers)
    nextGraded = null
    store.grills[body.quiz] = {
      grill: result.grill,
      course: found.course,
      written: found.written,
    }
    const out: GradedQuizOut = {
      quiz: quizOut(result.grill, found.course, found.written),
      remark: result.remark,
    }
    return HttpResponse.json(out)
  }),
  http.post('*/quizzes.abandon', async ({ request }) => {
    const body = (await request.json()) as { quiz: string }
    const found = store.grills[body.quiz]
    if (!found)
      return HttpResponse.json({ detail: 'no such quiz' }, { status: 404 })
    const abandoned: Grill = { ...found.grill, status: 'abandoned' }
    store.grills[body.quiz] = { ...found, grill: abandoned }
    return HttpResponse.json(quizOut(abandoned, found.course, found.written))
  }),
  http.get('*/sessions.list', ({ request }) =>
    HttpResponse.json(
      Object.values(store.sessions)
        .filter(
          (s): s is Session =>
            !!s &&
            s.course === scope(request) &&
            s.owner === request.headers.get('X-User'),
        )
        .map(sessionOut),
    ),
  ),
  http.get('*/sessions.get', ({ request }) => {
    const found =
      store.sessions[new URL(request.url).searchParams.get('session') ?? '']
    // A session belonging to another course or user is a 404, not someone else's history.
    if (!found || found.owner !== request.headers.get('X-User')) {
      return HttpResponse.json({ detail: 'no such session' }, { status: 404 })
    }
    return HttpResponse.json(sessionOut(found))
  }),
]
