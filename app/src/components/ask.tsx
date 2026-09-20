import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, QUERY_TYPES, ask, getSession } from '#/lib/api'
import type { Evidence, QueryType, Session, TierResult, Turn } from '#/lib/api'
import {
  ErrorLine,
  Icon,
  PageHeading,
  buttonClass,
  inputClass,
} from '#/components/common'
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

  const [selectedEvidence, setSelectedEvidence] = useState<{
    evidence: Evidence
    tier: TierResult['tier']
  } | null>(null)
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
    <section className="page study-page">
      <PageHeading
        eyebrow={`${course.toUpperCase()} / STUDY MODE`}
        title="Follow your curiosity"
        description="Ask, connect, understand. One course at a time."
      >
        {sessionId !== null && onLeaveSession && (
          <button
            className="button button-secondary"
            type="button"
            disabled={submit.isPending}
            onClick={() => {
              setSelectedEvidence(null)
              onLeaveSession()
            }}
          >
            <Icon name="plus" size={16} />
            New session
          </button>
        )}
      </PageHeading>
      <div className="study-workspace">
        <section
          className="panel conversation-panel"
          aria-label="Study Session"
        >
          <header className="panel-heading">
            <span className="assistant-label">
              <span className="assistant-mark">
                <Icon name="spark" size={16} />
              </span>
              Lattice study companion
            </span>
            <span className="tag">COURSE-SCOPED</span>
          </header>
          <div className="conversation-content">
            {session.isFetching && turns.length === 0 && (
              <p className="loading-line" role="status">
                Loading Session…
              </p>
            )}
            {!sessionId && turns.length === 0 && (
              <div className="ask-welcome">
                <span className="ask-emblem">
                  <Icon name="spark" size={34} />
                </span>
                <p className="eyebrow">A SPACE TO FIGURE THINGS OUT</p>
                <h2>
                  What would you like
                  <br />
                  to understand?
                </h2>
                <p>
                  Explore ideas from this course’s Materials and your private
                  Notes. Check the evidence behind each answer.
                </p>
                <div className="prompt-grid">
                  {[
                    'Explain a concept from my course',
                    'Help me connect two ideas',
                    'Clarify something in my Notes',
                  ].map((prompt) => (
                    <button
                      className="prompt-card"
                      key={prompt}
                      type="button"
                      onClick={() => setQuestion(`${prompt}: `)}
                    >
                      {prompt}
                      <Icon name="arrow" size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <ol className="turn-list">
              {turns.map((t) => (
                <li key={t.id}>
                  <TurnView
                    turn={t}
                    onEvidence={(evidence, tier) =>
                      setSelectedEvidence({ evidence, tier })
                    }
                  />
                </li>
              ))}
            </ol>
            {submit.isPending && (
              <p className="thinking-line" role="status">
                <span className="thinking-dot" />
                Looking through your course knowledge…
              </p>
            )}
            <ErrorLine error={submit.error} />
            {!(
              session.error instanceof ApiError && session.error.status === 404
            ) && <ErrorLine error={session.error} />}
          </div>
          <form
            className="ask-composer"
            onSubmit={(e) => {
              e.preventDefault()
              if (
                question.trim() &&
                !submit.isPending &&
                !session.isFetching &&
                !session.isError
              )
                submit.mutate({
                  question: question.trim(),
                  query_type: queryType,
                })
            }}
          >
            <label className="sr-only" htmlFor="study-question">
              Your question
            </label>
            <textarea
              id="study-question"
              value={question}
              rows={2}
              maxLength={2000}
              placeholder="Ask a question about this course"
              disabled={submit.isPending}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="composer-toolbar">
              <label className="query-control">
                <Icon name="spark" size={14} />
                <select
                  aria-label="Answer method"
                  className={inputClass}
                  value={queryType}
                  disabled={submit.isPending}
                  onChange={(e) => setQueryType(e.target.value as QueryType)}
                >
                  {QUERY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {queryTypeLabel[t]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={buttonClass}
                type="submit"
                disabled={
                  !question.trim() ||
                  submit.isPending ||
                  session.isFetching ||
                  session.isError
                }
              >
                {submit.isPending ? 'Asking…' : 'Ask'}
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </form>
          <p className="composer-disclaimer">
            Answers can be imperfect. Use the returned evidence to check them.
          </p>
          {sessionId && <p className="session-id">session {sessionId}</p>}
        </section>
        <aside className="panel evidence-panel" aria-label="Answer evidence">
          <header className="panel-heading">
            <h2>
              <Icon name="book" size={17} />
              Evidence & context
            </h2>
          </header>
          {selectedEvidence ? (
            <div className="evidence-detail">
              <div className="evidence-detail-heading">
                <span className="tag">{tierLabel[selectedEvidence.tier]}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close evidence"
                  onClick={() => setSelectedEvidence(null)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <h3>Evidence details</h3>
              <dl>
                {Object.entries({
                  Kind: selectedEvidence.evidence.kind,
                  Material: selectedEvidence.evidence.document_name,
                  'Chunk index': selectedEvidence.evidence.chunk_index,
                  'Chunk ID': selectedEvidence.evidence.chunk_id,
                  Label: selectedEvidence.evidence.label,
                  Relationship: selectedEvidence.evidence.relationship_name,
                })
                  .filter(([, value]) => value !== null)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
              <p className="muted small">
                This is the evidence metadata returned by the API. Chunk numbers
                are not slide or page numbers; passage previews are not
                available yet.
              </p>
            </div>
          ) : (
            <div className="evidence-placeholder">
              <span className="empty-icon">
                <Icon name="file" size={24} />
              </span>
              <h3>Understanding has a foundation.</h3>
              <p>
                Select evidence below an answer to inspect the returned
                Material, Chunk, or graph metadata.
              </p>
            </div>
          )}
          <div className="context-guide">
            <p className="eyebrow">YOUR KNOWLEDGE TIERS</p>
            <div>
              <span className="stat-icon blue">
                <Icon name="book" size={16} />
              </span>
              <p>
                <strong>Official Materials</strong>
                <span>Shared course knowledge</span>
              </p>
            </div>
            <div>
              <span className="stat-icon violet">
                <Icon name="lock" size={16} />
              </span>
              <p>
                <strong>Private Notes</strong>
                <span>Only your own writing</span>
              </p>
            </div>
            <p className="muted small">
              Answers are shown separately by tier. Only the evidence returned
              for this Session is displayed.
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}

const queryTypeLabel: Record<QueryType, string> = {
  GRAPH_COMPLETION: 'Graph answer',
  RAG_COMPLETION: 'Passage answer',
  HYBRID_COMPLETION: 'Hybrid answer',
  CHUNKS: 'Retrieved Chunks',
}

type EvidenceHandler = (evidence: Evidence, tier: TierResult['tier']) => void

function TurnView({
  turn,
  onEvidence,
}: {
  turn: Turn
  onEvidence: EvidenceHandler
}) {
  if (turn.role === 'user') {
    return (
      <div className="user-turn">
        <span className="turn-label">YOU</span>
        <p>{turn.content}</p>
      </div>
    )
  }
  return (
    <div className="assistant-turn">
      <span className="assistant-label">
        <Icon name="spark" size={16} />
        Lattice
      </span>
      {turn.results.map((r) => (
        <TierView key={r.tier} result={r} onEvidence={onEvidence} />
      ))}
      {turn.results.length === 0 && (
        <p className="muted">Nothing cognified in this course yet.</p>
      )}
      <p className="turn-meta">
        {turn.used_notes
          ? 'Includes your private Notes'
          : 'No private Notes used'}{' '}
        ·{' '}
        {turn.latency_ms === null
          ? 'Timing unavailable'
          : `${(turn.latency_ms / 1000).toFixed(1)}s`}
      </p>
    </div>
  )
}

const tierLabel: Record<TierResult['tier'], string> = {
  course: 'Course materials',
  notes: 'Your notes',
}

function TierView({
  result,
  onEvidence,
}: {
  result: TierResult
  onEvidence: EvidenceHandler
}) {
  return (
    <div className="tier-answer">
      <h3>
        <span className={`tier-dot ${result.tier}`} />
        {tierLabel[result.tier]}
      </h3>
      <p className="answer-text">
        {result.answer ?? <span className="muted">no answer</span>}
      </p>
      {result.evidence.length > 0 && (
        <ul className="evidence-chips">
          {result.evidence.map((e, i) => (
            <li key={i}>
              <button type="button" onClick={() => onEvidence(e, result.tier)}>
                <Icon
                  name={e.kind === 'segment' ? 'file' : 'graph'}
                  size={13}
                />
                {describeEvidence(e)}
              </button>
            </li>
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
