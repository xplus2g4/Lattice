import { HttpResponse, http } from 'msw'

import type { Material, Note, Session, Turn } from '#/lib/api'
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
}

// Paths are matched without an origin so a developer's VITE_API_URL cannot break the run.
export const handlers = [
  http.get('*/courses/:course/materials', ({ params }) =>
    HttpResponse.json(
      store.materials.filter((m) => m.course === params.course),
    ),
  ),

  http.post('*/courses/:course/materials', async ({ params, request }) => {
    // Read the filename out of the raw multipart body rather than calling
    // `request.formData()`. jsdom's `File` is not Node's, and undici's parser rejects it
    // outright, so the parse would throw before any handler logic ran.
    const filename = /filename="([^"]*)"/.exec(await request.text())?.[1]
    const at = new Date().toISOString()
    const created: Material = {
      course: String(params.course),
      filename: filename || 'unknown',
      status: 'queued',
      error: null,
      created_at: at,
      updated_at: at,
    }
    store.materials = [
      ...store.materials.filter(
        (m) =>
          !(m.course === created.course && m.filename === created.filename),
      ),
      created,
    ]
    return HttpResponse.json(created, { status: 202 })
  }),

  http.get('*/courses/:course/notes', ({ params, request }) => {
    const owner = request.headers.get('X-User')
    return HttpResponse.json(
      store.notes.filter(
        (n) => n.course === params.course && n.owner === owner,
      ),
    )
  }),

  http.put('*/courses/:course/notes/:noteId', async ({ params, request }) => {
    const { body_md } = (await request.json()) as { body_md: string }
    const saved: Note = {
      course: String(params.course),
      owner: request.headers.get('X-User') ?? '',
      id: String(params.noteId),
      body_md,
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
    return HttpResponse.json(saved, { status: 202 })
  }),

  http.post('*/courses/:course/ask', async ({ params, request }) => {
    const body = (await request.json()) as {
      question: string
      query_type?: string | null
      session_id?: string | null
    }
    const owner = request.headers.get('X-User') ?? ''
    const existing = body.session_id
      ? store.sessions[body.session_id]
      : undefined
    const current =
      existing ??
      session({
        id: body.session_id ?? 'sess-1',
        course: String(params.course),
        owner,
      })
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
    return HttpResponse.json({ session_id: current.id, turn: answered })
  }),

  http.get('*/courses/:course/sessions/:sessionId', ({ params, request }) => {
    const found = store.sessions[String(params.sessionId)]
    // A session belonging to another course or user is a 404, not someone else's history.
    if (
      !found ||
      found.course !== params.course ||
      found.owner !== request.headers.get('X-User')
    ) {
      return HttpResponse.json({ detail: 'no such session' }, { status: 404 })
    }
    return HttpResponse.json(found)
  }),
]
