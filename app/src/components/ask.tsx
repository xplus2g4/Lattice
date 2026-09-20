import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, QUERY_TYPES, ask, getSession } from '#/lib/api'
import type { Evidence, QueryType, Session, TierResult, Turn } from '#/lib/api'
import { ErrorLine, buttonClass, inputClass } from '#/components/common'
import type { Scope } from '#/components/common'

export interface AskProps extends Scope {
  /** The conversation being read, or null for one that has not started. Owned by the
   * route: a conversation is a URL, so it survives a reload and can be shared. */
  sessionId: string | null
  onSessionStarted: (sessionId: string) => void
  /** Called when the conversation should be abandoned, either because the user asked for
   * a new one or because the API no longer knows this one. */
  onLeaveSession?: () => void
}

export function Ask({
  course,
  user,
  sessionId,
  onSessionStarted,
  onLeaveSession,
}: AskProps) {
  const queryClient = useQueryClient()
  const session = useQuery({
    queryKey: ['session', course, user, sessionId],
    queryFn: () => getSession(user, course, sessionId ?? ''),
    enabled: sessionId !== null,
    retry: false,
  })

  // An id the server no longer knows is not an error to show the student.
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 404) {
      onLeaveSession?.()
    }
  }, [session.error, onLeaveSession])

  const [question, setQuestion] = useState('')
  const [queryType, setQueryType] = useState<QueryType>('GRAPH_COMPLETION')
  const submit = useMutation({
    mutationFn: (req: { question: string; query_type: QueryType }) =>
      ask(user, course, { ...req, session_id: sessionId }),
    onSuccess: (res, req) => {
      // The server keeps its own copy of this turn; this is the optimistic echo, so it
      // needs an id of its own rather than the one the server generated.
      const userTurn: Turn = {
        id: crypto.randomUUID(),
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
      onSessionStarted(res.session_id)
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
        {sessionId !== null && onLeaveSession && (
          <button
            className="rounded border border-gray-300 px-3 py-1 text-sm"
            type="button"
            disabled={submit.isPending}
            onClick={onLeaveSession}
          >
            New session
          </button>
        )}
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
      <p className="rounded bg-gray-100 px-3 py-2 text-sm">
        <span className="font-semibold">You: </span>
        {turn.content}
      </p>
    )
  }
  return (
    <div className="space-y-2 rounded border border-gray-200 px-3 py-2">
      {turn.results.map((r) => (
        <TierView key={r.tier} result={r} />
      ))}
      {turn.results.length === 0 && (
        <p className="text-sm italic text-gray-500">
          Nothing cognified in this course yet.
        </p>
      )}
      <p className="text-xs text-gray-500">
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
