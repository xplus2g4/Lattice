import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChatQuestionIcon, HistoryIcon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'

import { Markdown, ReferenceList } from '#/components/lattice/answer'
import { Button } from '#/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Textarea } from '#/components/ui/textarea'
import {
  ApiError,
  ask,
  getSession,
  listMaterials,
  listNotes,
  listSessions,
} from '#/lib/api'
import { groupReferences, relatedReferences } from '#/lib/references'
import { useStored } from '#/lib/user'

import type {
  Enrolment,
  Material,
  Note,
  Session,
  TierResult,
  Turn,
} from '#/lib/api'

export function AskPanel({ course, user }: Enrolment) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('ask')
  const [sessionId, setSessionId] = useStored(
    `lattice.session.${course}.${user}`,
    '',
  )

  const sessionKey = ['session', course, user, sessionId]
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: () => getSession(course, sessionId),
    enabled: sessionId !== '',
    retry: false,
  })
  const sessions = useQuery({
    queryKey: ['sessions', course, user],
    queryFn: () => listSessions(course),
  })
  // Shared with the rail; used for the pending notice and to resolve references.
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(course),
  })
  const pending =
    materials.data?.filter(
      (m) => m.status === 'queued' || m.status === 'cognifying',
    ).length ?? 0
  const notes = useQuery({
    queryKey: ['notes', course, user],
    queryFn: () => listNotes(course),
  })
  const sources = {
    course,
    materials: materials.data ?? [],
    notes: notes.data ?? [],
  }

  // A stored id the server no longer knows is dropped.
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 404) {
      setSessionId(null)
    }
  }, [session.error, setSessionId])

  const [question, setQuestion] = useState('')
  const submit = useMutation({
    mutationFn: (q: string) =>
      ask(course, {
        question: q,
        query_type: 'HYBRID_COMPLETION',
        session_id: sessionId || null,
      }),
    onSuccess: (res, q) => {
      const userTurn: Turn = {
        role: 'user',
        content: q,
        query_type: 'HYBRID_COMPLETION',
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
      void sessions.refetch()
    },
    // A failed ask goes back into the field, so the question is not lost.
    onError: (_, q) => setQuestion(q),
  })
  const send = () => {
    const q = question.trim()
    if (!q || submit.isPending) return
    // Cleared at once; the pending echo reads the in-flight question from the mutation.
    setQuestion('')
    submit.mutate(q)
  }

  // Disabling the field while asking drops focus; hand it back once the answer is in.
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const wasAsking = useRef(false)
  useEffect(() => {
    if (wasAsking.current && !submit.isPending) fieldRef.current?.focus()
    wasAsking.current = submit.isPending
  }, [submit.isPending])

  const turns = session.data?.turns ?? []
  // Scroll to the bottom when a question is sent, so its echo and the pending mark are in
  // view; not when the answer lands, so a student reading further up is not pulled down.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (submit.isPending)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [submit.isPending])

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="flex items-center justify-between border-b border-border px-5">
        <TabsList variant="line" className="gap-5 p-0">
          <TabsTrigger value="ask" className="rounded-none px-1 pb-3">
            <HugeiconsIcon icon={ChatQuestionIcon} data-icon="inline-start" />
            Ask
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-none px-1 pb-3">
            <HugeiconsIcon icon={HistoryIcon} data-icon="inline-start" />
            History
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setSessionId(null)}
          disabled={!sessionId}
        >
          New session
        </Button>
      </div>

      <TabsContent value="ask" className="flex min-h-0 flex-1 flex-col">
        {pending > 0 && (
          <p className="border-b border-border bg-feedback-developing px-5 py-2 text-xs text-feedback-developing-text">
            {pending} {pending === 1 ? 'material is' : 'materials are'} still
            cognifying — answers may be incomplete.
          </p>
        )}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
          {turns.length === 0 && !submit.isPending && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-lattice-heading font-semibold tracking-tight">
                Ask {course.toUpperCase()} anything
              </p>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                Answers cite the materials and your notes they came from. Upload
                materials in the left rail to feed this course.
              </p>
            </div>
          )}
          <ol className="space-y-4">
            {turns.map((t, i) => (
              <li key={t.id ?? i}>
                <TurnView turn={t} sources={sources} />
              </li>
            ))}
            {submit.isPending && (
              <li>
                <PendingTurn question={submit.variables} />
              </li>
            )}
          </ol>
        </div>
        <form
          className="space-y-2 border-t border-border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <Textarea
            ref={fieldRef}
            value={question}
            maxLength={2000}
            disabled={submit.isPending}
            placeholder={`Ask about ${course.toUpperCase()} materials or your notes…`}
            className="min-h-20 bg-background"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            {submit.error ? (
              <p className="text-xs text-destructive">{submit.error.message}</p>
            ) : (
              <p className="text-lattice-meta text-muted-foreground">
                ⌘↵ to send
              </p>
            )}
            <Button
              type="submit"
              disabled={!question.trim() || submit.isPending}
            >
              {submit.isPending ? 'Asking…' : 'Ask Lattice'}
            </Button>
          </div>
        </form>
      </TabsContent>

      <TabsContent
        value="history"
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <ul className="space-y-2">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setSessionId(s.id)
                  setTab('ask')
                }}
                className={`block w-full rounded-lg border px-3 py-2 text-left transition-colors hover:border-primary/50 ${
                  s.id === sessionId
                    ? 'border-primary/50 bg-accent'
                    : 'border-border bg-card'
                }`}
              >
                <span className="block truncate text-sm font-medium">
                  {s.first_question ?? 'Untitled session'}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {s.turn_count} {s.turn_count === 1 ? 'turn' : 'turns'} ·{' '}
                  {new Date(s.created_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
          {sessions.data?.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No past sessions for this course.
            </li>
          )}
        </ul>
      </TabsContent>
    </Tabs>
  )
}

function PendingTurn({ question }: { question: string }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {question}
        </p>
      </div>
      <p className="text-sm italic text-muted-foreground">Thinking…</p>
    </div>
  )
}

interface Sources {
  course: string
  materials: ReadonlyArray<Material>
  notes: ReadonlyArray<Note>
}

function TurnView({ turn, sources }: { turn: Turn; sources: Sources }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {turn.content}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-lattice">
      {turn.results.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          Nothing cognified in this course yet — upload a material and try
          again.
        </p>
      ) : (
        <>
          {/* The server composes one answer across the course's own tiers (study.py); the
              references it drew on are listed once too, Materials and Notes alike. */}
          {turn.content ? (
            <Markdown>{turn.content}</Markdown>
          ) : (
            <p className="text-sm italic text-muted-foreground">no answer</p>
          )}
          <ReferenceList
            course={sources.course}
            references={groupReferences(
              turn.results
                .filter((r) => r.tier !== 'related')
                .flatMap((r) => r.citations),
              sources.materials,
              sources.notes,
            )}
          />
          {turn.results
            .filter((r) => r.tier === 'related')
            .map((r) => (
              <RelatedCourseView key={r.course ?? ''} result={r} />
            ))}
        </>
      )}
      <p className="text-lattice-meta text-muted-foreground">
        {turn.latency_ms ?? '?'} ms
      </p>
    </div>
  )
}

/** A related course's answer stays apart from the course's own, under the code it came
 * from: a few bullet points, with each reference opening that course's reader in a new
 * tab so this workspace stays put. */
function RelatedCourseView({ result }: { result: TierResult }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="text-lattice-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {`Related course · ${result.course?.toUpperCase() ?? '?'}`}
      </p>
      <div className="mt-1.5">
        {result.answer ? (
          <Markdown>{result.answer}</Markdown>
        ) : (
          <p className="text-sm italic text-muted-foreground">no answer</p>
        )}
      </div>
      <ReferenceList
        course={result.course ?? ''}
        references={relatedReferences(result.citations, result.course)}
        newTab
      />
    </div>
  )
}
