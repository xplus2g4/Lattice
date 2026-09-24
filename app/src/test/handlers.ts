import { HttpResponse, http } from 'msw'

import type { Material, Note, Session, Turn } from '#/lib/api'
import type {
  CourseOut,
  MaterialOut,
  NoteOut,
  SessionOut,
  TurnOut,
  UploadOut,
} from '#/lib/generated'
import { assistantTurn, session, userTurn } from './fixtures'

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
}
export const store: Store = { materials: [], notes: [], sessions: {} }
let nextAnswer: Turn | null = null
let nextNote = 1

/** Shape the next answer without replacing the handler, which would skip the session
 * bookkeeping the client depends on and leave `/ask` returning an id nothing can read. */
export function answerNextAskWith(turn: Turn) {
  nextAnswer = turn
}
export function resetStore(next: Partial<Store> = {}) {
  store.materials = next.materials ?? []
  store.notes = next.notes ?? []
  store.sessions = next.sessions ?? {}
  nextAnswer = null
  nextNote = 1
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
    id: idFor(`${m.course}:${m.filename}`),
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
        tier: r.tier === 'global' ? 'course' : 'notes',
        dataset_name: r.tier,
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
function scope(request: Request) {
  return new URL(request.url).searchParams.get('course') ?? ''
}

// Paths are matched without an origin so a developer's VITE_API_URL cannot break the run.
export const handlers = [
  // The session probe `useMe`/`authed` share: in tests the signed-in user is the
  // fixture owner, which is also who the per-user stores and X-User filters expect.
  http.get('*/me.get', () =>
    HttpResponse.json({
      user: {
        id: idFor('alice@example.com'),
        email: 'alice@example.com',
        name: null,
        role: 'student',
        notes_opt_out: false,
      },
      courses: [],
    }),
  ),
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
      new HttpResponse('sample material', {
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
    return HttpResponse.json({
      session: current.id,
      turn: turnOut(answered, current.id),
    })
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
