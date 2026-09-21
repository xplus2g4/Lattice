import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import {
  ApiError,
  QUERY_TYPES,
  ask,
  createCourse,
  getSession,
  joinCourse,
  listMaterials,
  listNotes,
  rateTurn,
  saveNote,
  uploadMaterial,
} from '#/lib/api'
import type {
  Evidence,
  IngestStatus,
  Material,
  Note,
  NoteStatus,
  QueryType,
  Session,
  TierResult,
  Turn,
} from '#/lib/api'

export const Route = createFileRoute('/')({ component: Home })

const COURSE_RE = /^[a-z][a-z0-9]{1,15}$/

// localStorage as an external store so SSR renders the fallback and the
// client re-renders with the stored value after hydration.
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

function useStored(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) ?? fallback,
    () => fallback,
  )
  const set = useCallback(
    (next: string | null) => {
      if (next === null) localStorage.removeItem(key)
      else localStorage.setItem(key, next)
      listeners.forEach((l) => l())
    },
    [key],
  )
  return [value, set] as const
}

const pending: ReadonlyArray<string> = [
  'queued',
  'converting',
  'cognifying',
  'dirty',
  'indexing',
]

function pollWhilePending<T extends { status: string }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => pending.includes(i.status)) ? 2000 : false
}

const inputClass = 'rounded border border-gray-300 px-2 py-1 text-sm'
const buttonClass =
  'rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50'

function Home() {
  const [course, setCourse] = useStored('lattice.course', 'cs101')
  const [user, setUser] = useStored('lattice.user', 'alice@example.com')
  const courseOk = COURSE_RE.test(course)
  const ready = courseOk && user.trim() !== ''

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-2xl font-bold">Course knowledge store</h1>
        <label className="flex flex-col text-xs">
          Course
          <input
            className={inputClass}
            value={course}
            onChange={(e) => setCourse(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs">
          User
          <input
            className={inputClass}
            type="email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </label>
      </header>
      {!courseOk && (
        <p className="text-sm text-red-700">
          Course code must match {COURSE_RE.source}
        </p>
      )}
      {ready && <Enrolled course={course} user={user} />}
    </main>
  )
}

interface Scope {
  course: string
  user: string
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p className="text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

const statusColor: Record<IngestStatus | NoteStatus, string> = {
  queued: 'bg-gray-200 text-gray-800',
  dirty: 'bg-gray-200 text-gray-800',
  converting: 'bg-yellow-200 text-yellow-900',
  cognifying: 'bg-yellow-200 text-yellow-900',
  indexing: 'bg-yellow-200 text-yellow-900',
  ready: 'bg-green-200 text-green-900',
  failed: 'bg-red-200 text-red-900',
}

/** Everything below needs the caller enrolled: the course owns its Materials and Datasets. */
function Enrolled({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const enrolment = useQuery({
    queryKey: ['enrolment', course, user],
    queryFn: () => joinCourse(user, course),
    retry: false,
  })
  const create = useMutation({
    mutationFn: () => createCourse(user, course, course.toUpperCase()),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['enrolment', course, user] }),
  })
  const missing =
    enrolment.error instanceof ApiError && enrolment.error.status === 404

  if (missing) {
    return (
      <section className="space-y-2">
        <p className="text-sm">No course {course} yet.</p>
        <button
          className={buttonClass}
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          Create it
        </button>
        <ErrorLine error={create.error} />
      </section>
    )
  }
  if (!enrolment.isSuccess) return <ErrorLine error={enrolment.error} />
  return (
    <>
      <Materials course={course} user={user} />
      <Notes course={course} user={user} />
      <Ask course={course} user={user} />
    </>
  )
}

function StatusBadge({ status }: { status: IngestStatus | NoteStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${statusColor[status]}`}>
      {status}
    </span>
  )
}

function Materials({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const key = ['materials', course, user]
  const materials = useQuery({
    queryKey: key,
    queryFn: () => listMaterials(user, course),
    refetchInterval: (q) => pollWhilePending<Material>(q.state.data),
  })
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    mutationFn: (f: File) => uploadMaterial(user, course, f),
    onSuccess: () => {
      setFile(null)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Materials</h2>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (file) upload.mutate(file)
        }}
      >
        <input
          className="text-sm"
          type="file"
          accept=".pdf,.pptx,.md,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          className={buttonClass}
          type="submit"
          disabled={!file || upload.isPending}
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      <ErrorLine error={upload.error} />
      <ErrorLine error={materials.error} />
      <ul className="divide-y divide-gray-200">
        {materials.data?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-1">
            <span className="text-sm">{m.filename}</span>
            <StatusBadge status={m.status} />
            {m.status === 'failed' && m.error && (
              <span className="text-xs text-red-700">{m.error}</span>
            )}
          </li>
        ))}
        {materials.data?.length === 0 && (
          <li className="text-sm text-gray-500">No materials yet.</li>
        )}
      </ul>
    </section>
  )
}

function Notes({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const key = ['notes', course, user]
  const notes = useQuery({
    queryKey: key,
    queryFn: () => listNotes(user, course),
    refetchInterval: (q) => pollWhilePending<Note>(q.state.data),
  })
  const [noteId, setNoteId] = useState<string | undefined>(undefined)
  const [body, setBody] = useState('')
  const save = useMutation({
    mutationFn: () => saveNote(user, course, body, noteId),
    onSuccess: (note) => {
      setNoteId(note.id)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Notes</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <textarea
          className={`${inputClass} block w-full`}
          rows={4}
          value={body}
          placeholder="Markdown body"
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className={buttonClass}
            type="submit"
            disabled={!body.trim() || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            className="rounded border border-gray-300 px-3 py-1 text-sm"
            type="button"
            onClick={() => {
              setNoteId(undefined)
              setBody('')
            }}
          >
            New note
          </button>
        </div>
      </form>
      <ErrorLine error={save.error} />
      <ErrorLine error={notes.error} />
      <ul className="divide-y divide-gray-200">
        {notes.data?.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-2 py-1">
            <button
              className="font-mono text-sm underline"
              type="button"
              onClick={() => {
                setNoteId(n.id)
                setBody(n.body_md)
              }}
            >
              {n.id.slice(0, 8)}
            </button>
            <StatusBadge status={n.status} />
            <span className="text-sm text-gray-600">
              {n.body_md.slice(0, 80)}
            </span>
            {n.status === 'failed' && n.error && (
              <span className="text-xs text-red-700">{n.error}</span>
            )}
          </li>
        ))}
        {notes.data?.length === 0 && (
          <li className="text-sm text-gray-500">No notes yet.</li>
        )}
      </ul>
    </section>
  )
}

function Ask({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useStored(
    `lattice.session.${course}.${user}`,
    '',
  )
  const sessionKey = ['session', course, user, sessionId]
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: () => getSession(user, sessionId),
    enabled: sessionId !== '',
    retry: false,
  })

  // A stored id the server no longer knows is dropped.
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 404) {
      setSessionId(null)
    }
  }, [session.error, setSessionId])

  const [question, setQuestion] = useState('')
  const [queryType, setQueryType] = useState<QueryType>('GRAPH_COMPLETION')
  const submit = useMutation({
    mutationFn: (req: { question: string; query_type: QueryType }) =>
      ask(user, course, { ...req, session: sessionId || null }),
    onSuccess: (res, req) => {
      const now = new Date().toISOString()
      const asked: Turn = {
        id: `${res.turn.id}-question`,
        session_id: res.session,
        role: 'user',
        content_json: { text: req.question, query_type: req.query_type },
        cited_chunk_ids: [],
        used_notes: false,
        latency_ms: null,
        created_at: now,
      }
      queryClient.setQueryData<Session>(
        ['session', course, user, res.session],
        (prev) => ({
          id: res.session,
          course_id: course,
          created_at: now,
          ...prev,
          last_turn_at: now,
          turns: [...(prev?.turns ?? []), asked, res.turn],
        }),
      )
      setSessionId(res.session)
      setQuestion('')
    },
  })

  const turns = session.data?.turns ?? []

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Ask</h2>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate({ question, query_type: queryType })
        }}
      >
        <input
          className={`${inputClass} min-w-64 flex-1`}
          value={question}
          maxLength={2000}
          placeholder="Ask a question about this course"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <select
          className={inputClass}
          value={queryType}
          onChange={(e) => setQueryType(e.target.value as QueryType)}
        >
          {QUERY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          className={buttonClass}
          type="submit"
          disabled={!question.trim() || submit.isPending}
        >
          {submit.isPending ? 'Asking…' : 'Ask'}
        </button>
        <button
          className="rounded border border-gray-300 px-3 py-1 text-sm"
          type="button"
          disabled={submit.isPending}
          onClick={() => setSessionId(null)}
        >
          New session
        </button>
      </form>
      <ErrorLine error={submit.error} />
      {!(session.error instanceof ApiError && session.error.status === 404) && (
        <ErrorLine error={session.error} />
      )}
      {sessionId && (
        <p className="font-mono text-xs text-gray-500">session {sessionId}</p>
      )}
      <ol className="space-y-3">
        {turns.map((t) => (
          <li key={t.id}>
            <TurnView turn={t} user={user} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function TurnView({ turn, user }: { turn: Turn; user: string }) {
  const rate = useMutation({
    mutationFn: (rating: 1 | -1) => rateTurn(user, turn.id, rating),
  })
  if (turn.role === 'user') {
    return (
      <p className="rounded bg-gray-100 px-3 py-2 text-sm">
        <span className="font-semibold">You: </span>
        {turn.content_json.text}
      </p>
    )
  }
  const results = turn.content_json.results ?? []
  return (
    <div className="space-y-2 rounded border border-gray-200 px-3 py-2">
      {results.map((r) => (
        <TierView key={r.tier} result={r} />
      ))}
      {results.length === 0 && (
        <p className="text-sm italic text-gray-500">
          Nothing cognified in this course yet.
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        used_notes: {String(turn.used_notes)} · {turn.latency_ms ?? '?'} ms ·{' '}
        {turn.content_json.query_type ?? '?'}
        <button type="button" onClick={() => rate.mutate(1)}>
          helpful
        </button>
        <button type="button" onClick={() => rate.mutate(-1)}>
          not helpful
        </button>
        {rate.isSuccess && <span>rated</span>}
      </p>
    </div>
  )
}

const tierLabel: Record<TierResult['tier'], string> = {
  course: 'Course materials',
  notes: 'Your notes',
}

function TierView({ result }: { result: TierResult }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-gray-500">
        {tierLabel[result.tier]}
      </h3>
      <p className="text-sm whitespace-pre-wrap">
        {result.answer ?? (
          <span className="italic text-gray-500">no answer</span>
        )}
      </p>
      {result.evidence.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
          {result.evidence.map((e, i) => (
            <li key={i}>{describeEvidence(e)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function describeEvidence(e: Evidence): string {
  switch (e.kind) {
    case 'segment':
      return `${e.document_name ?? '?'}${e.chunk_index !== null ? ` #${e.chunk_index}` : ''} · chunk`
    case 'graph_edge':
      return `${e.relationship_name ?? '?'} · edge`
    default:
      return `${e.label ?? '?'} · ${e.kind}`
  }
}
