import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { StatusBadge } from '#/components/lattice/status-badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import {
  ApiError,
  QUERY_TYPES,
  ask,
  describeCitation,
  getSession,
  listMaterials,
  listNotes,
  pollWhilePending,
  saveNote,
  uploadMaterial,
} from '#/lib/api'
import { useStored } from '#/lib/user'
import type {
  Enrolment,
  Material,
  Note,
  QueryType,
  Session,
  TierResult,
  Turn,
} from '#/lib/api'

export const Route = createFileRoute('/dev')({ component: Home })

const COURSE_RE = /^[a-z][a-z0-9]{1,15}$/

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
          <Input value={course} onChange={(e) => setCourse(e.target.value)} />
        </label>
        <label className="flex flex-col text-xs">
          User
          <Input
            type="email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </label>
      </header>
      {!courseOk && (
        <p className="text-sm text-destructive">
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
    </main>
  )
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p className="text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

function Materials({ course, user }: Enrolment) {
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
        <Button type="submit" size="sm" disabled={!file || upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </form>
      <ErrorLine error={upload.error} />
      <ErrorLine error={materials.error} />
      <ul className="divide-y divide-border">
        {materials.data?.map((m) => (
          <li
            key={m.filename}
            className="flex flex-wrap items-center gap-2 py-1"
          >
            <span className="text-sm">{m.filename}</span>
            <StatusBadge status={m.status} />
            {m.status === 'failed' && m.error && (
              <span className="text-xs text-destructive">{m.error}</span>
            )}
          </li>
        ))}
        {materials.data?.length === 0 && (
          <li className="text-sm text-muted-foreground">No materials yet.</li>
        )}
      </ul>
    </section>
  )
}

function Notes({ course, user }: Enrolment) {
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
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Notes</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input
          value={noteId}
          pattern="[A-Za-z0-9_\-]{1,64}"
          placeholder="note id"
          onChange={(e) => setNoteId(e.target.value)}
        />
        <Textarea
          className="block w-full"
          rows={4}
          value={body}
          placeholder="Markdown body"
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!noteId || !body.trim() || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <ErrorLine error={save.error} />
      <ErrorLine error={notes.error} />
      <ul className="divide-y divide-border">
        {notes.data?.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-2 py-1">
            <span className="font-mono text-sm">{n.id}</span>
            <StatusBadge status={n.status} />
            <span className="text-sm text-muted-foreground">
              {n.body_md.slice(0, 80)}
            </span>
            {n.status === 'failed' && n.error && (
              <span className="text-xs text-destructive">{n.error}</span>
            )}
          </li>
        ))}
        {notes.data?.length === 0 && (
          <li className="text-sm text-muted-foreground">No notes yet.</li>
        )}
      </ul>
    </section>
  )
}

function Ask({ course, user }: Enrolment) {
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
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Ask</h2>
      <form
        className="flex flex-wrap items-center gap-2"
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
        <select
          className="rounded-lg border border-border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring"
          value={queryType}
          onChange={(e) => setQueryType(e.target.value as QueryType)}
        >
          {QUERY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          size="sm"
          disabled={!question.trim() || submit.isPending}
        >
          {submit.isPending ? 'Asking…' : 'Ask'}
        </Button>
        <Button
          variant="outline"
          size="sm"
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
        <p className="font-mono text-xs text-muted-foreground">
          session {sessionId}
        </p>
      )}
      <ol className="space-y-3">
        {turns.map((t, i) => (
          <li key={t.id ?? i}>
            <TurnView turn={t} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <p className="rounded bg-muted px-3 py-2 text-sm">
        <span className="font-semibold">You: </span>
        {turn.content}
      </p>
    )
  }
  return (
    <div className="space-y-2 rounded border border-border px-3 py-2">
      {turn.results.map((r) => (
        <TierView key={r.tier} result={r} />
      ))}
      {turn.results.length === 0 && (
        <p className="text-sm italic text-muted-foreground">
          Nothing cognified in this course yet.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        used_notes: {String(turn.used_notes)} · {turn.latency_ms ?? '?'} ms ·{' '}
        {turn.query_type ?? '?'}
      </p>
    </div>
  )
}

const tierLabel: Record<TierResult['tier'], string> = {
  global: 'Course materials',
  private: 'Your notes',
}

function TierView({ result }: { result: TierResult }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        {tierLabel[result.tier]}
      </h3>
      <p className="text-sm whitespace-pre-wrap">
        {result.answer ?? (
          <span className="italic text-muted-foreground">no answer</span>
        )}
      </p>
      {result.citations.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
          {result.citations.map((c, i) => (
            <li key={i}>{describeCitation(c)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
