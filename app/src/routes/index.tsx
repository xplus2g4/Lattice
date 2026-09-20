import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import {
  Badge,
  Button,
  EmptyState,
  FieldLabel,
  Input,
  Panel,
  Select,
  Textarea,
} from '#/components/ui'
import {
  ApiError,
  QUERY_TYPES,
  ask,
  getSession,
  listMaterials,
  listNotes,
  saveNote,
  uploadMaterial,
} from '#/lib/api'
import type {
  Evidence,
  IngestStatus,
  Material,
  Note,
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

function pollWhilePending<T extends { status: IngestStatus }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => i.status === 'queued' || i.status === 'cognifying')
    ? 2000
    : false
}

function Home() {
  const [course, setCourse] = useStored('lattice.course', 'cs101')
  const [user, setUser] = useStored('lattice.user', 'alice@example.com')
  const courseOk = COURSE_RE.test(course)
  const ready = courseOk && user.trim() !== ''

  return (
    <main className="min-h-screen bg-lattice-canvas px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-end gap-4">
          <div className="mr-auto">
            <p className="text-sm font-semibold text-lattice-violet">
              lattice.
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Your course knowledge
            </h1>
            <p className="mt-1 text-lattice-muted">
              Ask, save, and return to what matters.
            </p>
          </div>
          <FieldLabel className="w-36">
            Course
            <Input value={course} onChange={(e) => setCourse(e.target.value)} />
          </FieldLabel>
          <FieldLabel className="w-52">
            User
            <Input
              type="email"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </FieldLabel>
        </header>
        {!courseOk && (
          <p className="text-sm text-lattice-danger">
            Course code must match {COURSE_RE.source}
          </p>
        )}
        {ready && (
          <>
            <Materials course={course} user={user} />
            <Notes course={course} user={user} />
            <Ask course={course} user={user} />
          </>
        )}
      </div>
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
    <p className="text-sm text-lattice-danger">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

const statusTone: Record<
  IngestStatus,
  'neutral' | 'warning' | 'success' | 'danger'
> = {
  queued: 'neutral',
  cognifying: 'warning',
  ready: 'success',
  failed: 'danger',
}

function StatusBadge({ status }: { status: IngestStatus }) {
  return <Badge tone={statusTone[status]}>{status}</Badge>
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
    <Panel className="p-6">
      <div className="mb-5">
        <p className="text-sm font-semibold text-lattice-violet">KNOWLEDGE</p>
        <h2 className="mt-1 text-xl font-semibold">Materials</h2>
        <p className="mt-1 text-sm text-lattice-muted">
          Your course Materials are available to everyone enrolled.
        </p>
      </div>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (file) upload.mutate(file)
        }}
      >
        <Input
          className="max-w-sm file:mr-3 file:rounded-md file:border-0 file:bg-lattice-subtle file:px-2 file:py-1 file:text-sm file:font-medium file:text-lattice-ink"
          type="file"
          accept=".pdf,.pptx,.md,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button type="submit" disabled={!file || upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </form>
      <ErrorLine error={upload.error} />
      <ErrorLine error={materials.error} />
      <ul className="mt-4 divide-y divide-lattice-border">
        {materials.data?.map((m) => (
          <li
            key={m.filename}
            className="flex flex-wrap items-center gap-2 py-3"
          >
            <span className="text-sm">{m.filename}</span>
            <StatusBadge status={m.status} />
            {m.status === 'failed' && m.error && (
              <span className="text-xs text-lattice-danger">{m.error}</span>
            )}
          </li>
        ))}
        {materials.data?.length === 0 && (
          <li>
            <EmptyState>No Materials yet.</EmptyState>
          </li>
        )}
      </ul>
    </Panel>
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
  const [noteId, setNoteId] = useState('n1')
  const [body, setBody] = useState('')
  const save = useMutation({
    mutationFn: () => saveNote(user, course, noteId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return (
    <Panel className="p-6">
      <div className="mb-5">
        <p className="text-sm font-semibold text-lattice-violet">
          PRIVATE TIER
        </p>
        <h2 className="mt-1 text-xl font-semibold">Your Notes</h2>
        <p className="mt-1 text-sm text-lattice-muted">
          Notes are readable only by you in this course.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input
          className="max-w-xs"
          value={noteId}
          pattern="[A-Za-z0-9_\-]{1,64}"
          placeholder="note id"
          onChange={(e) => setNoteId(e.target.value)}
        />
        <Textarea
          rows={4}
          value={body}
          placeholder="Markdown body"
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          type="submit"
          disabled={!noteId || !body.trim() || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <ErrorLine error={save.error} />
      <ErrorLine error={notes.error} />
      <ul className="mt-4 divide-y divide-lattice-border">
        {notes.data?.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-2 py-3">
            <span className="font-mono text-sm">{n.id}</span>
            <StatusBadge status={n.status} />
            <span className="text-sm text-lattice-muted">
              {n.body_md.slice(0, 80)}
            </span>
            {n.status === 'failed' && n.error && (
              <span className="text-xs text-lattice-danger">{n.error}</span>
            )}
          </li>
        ))}
        {notes.data?.length === 0 && (
          <li>
            <EmptyState>No Notes yet.</EmptyState>
          </li>
        )}
      </ul>
    </Panel>
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
    queryFn: () => getSession(user, course, sessionId),
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
      ask(user, course, { ...req, session_id: sessionId || null }),
    onSuccess: (res, req) => {
      const userTurn: Turn = {
        role: 'user',
        content: req.question,
        query_type: req.query_type,
        results: [],
        used_notes: false,
        latency_ms: null,
        created_at: new Date().toISOString(),
      }
      queryClient.setQueryData<Session>(
        ['session', course, user, res.session_id],
        (prev) => ({
          id: res.session_id,
          course,
          owner: user,
          created_at: userTurn.created_at,
          ...prev,
          turns: [...(prev?.turns ?? []), userTurn, res.turn],
        }),
      )
      setSessionId(res.session_id)
      setQuestion('')
    },
  })

  const turns = session.data?.turns ?? []

  return (
    <Panel className="p-6">
      <div className="mb-5">
        <p className="text-sm font-semibold text-lattice-violet">SESSION</p>
        <h2 className="mt-1 text-xl font-semibold">Ask your course</h2>
        <p className="mt-1 text-sm text-lattice-muted">
          Answers cite the Material and Notes they retrieve.
        </p>
      </div>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate({ question, query_type: queryType })
        }}
      >
        <Input
          className="min-w-64 flex-1"
          value={question}
          maxLength={2000}
          placeholder="Ask a question about this course"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Select
          className="w-auto"
          value={queryType}
          onChange={(e) => setQueryType(e.target.value as QueryType)}
        >
          {QUERY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={!question.trim() || submit.isPending}>
          {submit.isPending ? 'Asking…' : 'Ask'}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={submit.isPending}
          onClick={() => setSessionId(null)}
        >
          New session
        </Button>
      </form>
      <ErrorLine error={submit.error} />
      {!(session.error instanceof ApiError && session.error.status === 404) && (
        <ErrorLine error={session.error} />
      )}
      {sessionId && (
        <p className="font-mono text-xs text-lattice-muted">
          session {sessionId}
        </p>
      )}
      <ol className="mt-5 space-y-3">
        {turns.map((t, i) => (
          <li key={t.id ?? i}>
            <TurnView turn={t} />
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <p className="rounded-2xl bg-lattice-subtle px-4 py-3 text-sm">
        <span className="font-semibold">You: </span>
        {turn.content}
      </p>
    )
  }
  return (
    <div className="space-y-3 rounded-2xl border border-lattice-border bg-lattice-surface px-4 py-4">
      {turn.results.map((r) => (
        <TierView key={r.tier} result={r} />
      ))}
      {turn.results.length === 0 && (
        <p className="text-sm italic text-lattice-muted">
          Nothing cognified in this course yet.
        </p>
      )}
      <p className="text-xs text-lattice-muted">
        used_notes: {String(turn.used_notes)} · {turn.latency_ms ?? '?'} ms ·{' '}
        {turn.query_type ?? '?'}
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-lattice-violet">
        {tierLabel[result.tier]}
      </h3>
      <p className="text-sm whitespace-pre-wrap">
        {result.answer ?? (
          <span className="italic text-lattice-muted">no answer</span>
        )}
      </p>
      {result.evidence.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-lattice-muted">
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
