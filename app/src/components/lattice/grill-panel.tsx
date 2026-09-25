import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { bumpJump, pageSearch } from '#/components/lattice/answer'
import { Button } from '#/components/ui/button'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { Textarea } from '#/components/ui/textarea'
import {
  abandonGrill,
  extendGrill,
  generateGrill,
  gradeGrill,
  listMaterials,
} from '#/lib/api'
import { useStored } from '#/lib/storage'
import { parseTab } from '#/lib/tabs'
import { cn } from '#/lib/utils'

import type {
  Enrolment,
  Grill,
  GrillBatch,
  GrillQuestion,
  GrillResult,
  Material,
} from '#/lib/api'
import type { TabKey } from '#/lib/tabs'

// Three stages, one at a time: choose a Material, answer the questions, read the result.
// The Grill itself is on the server from the moment it is planned; this is only which of
// its views is on screen, which batches are still being written, and what has been typed.
type Stage =
  | { at: 'pick' }
  | {
      at: 'quiz'
      grill: Grill
      batches: Array<GrillBatch>
      pending: Array<number>
      failed: Array<number>
    }
  | { at: 'result'; result: GrillResult }

type Answers = Partial<Record<string, string>>
interface Draft {
  stage: Stage
  answers: Answers
}

const FRESH: Draft = { stage: { at: 'pick' }, answers: {} }

// The panel unmounts whenever Ask or History is in front, so the draft lives in
// localStorage per course and user and comes back when the Grill tab returns, or after a
// reload. Batches still pending then are simply asked for again: the server returns what
// it already wrote.
function parseDraft(stored: string): Draft {
  if (!stored) return FRESH
  try {
    const value: unknown = JSON.parse(stored)
    if (
      value &&
      typeof value === 'object' &&
      'stage' in value &&
      'answers' in value
    )
      return value as Draft
  } catch {
    // Not ours, or damaged: start over.
  }
  return FRESH
}

function draftKey(course: string, user: string) {
  return `lattice.grill:${course}:${user}`
}

function readDraft(key: string): Draft {
  try {
    return parseDraft(localStorage.getItem(key) ?? '')
  } catch {
    return FRESH
  }
}

function byPosition(questions: ReadonlyArray<GrillQuestion>) {
  return [...questions].sort((a, b) => a.position - b.position)
}

export function GrillPanel({
  course,
  user,
  front,
}: Enrolment & { front: TabKey | null }) {
  const key = draftKey(course, user)
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(course),
  })
  const [stored, setStored] = useStored(key, '')
  const { stage, answers } = useMemo(() => parseDraft(stored), [stored])
  // Reads the latest draft rather than the one this render closed over: a batch can land
  // after other changes, or after the panel has unmounted.
  const patch = (change: (draft: Draft) => Draft) =>
    setStored(JSON.stringify(change(readDraft(key))))
  const setStage = (next: Stage) => patch(() => ({ stage: next, answers: {} }))

  const generate = useMutation({
    mutationFn: (material: string) => generateGrill(course, material),
    onSuccess: (plan) =>
      setStage({
        at: 'quiz',
        grill: plan.grill,
        batches: plan.batches,
        pending: plan.batches.map((b) => b.index),
        failed: [],
      }),
  })
  const grade = useMutation({
    mutationFn: (input: {
      grill: string
      answers: Array<{ question: string; answer_text: string }>
    }) => gradeGrill(input.grill, input.answers),
    onSuccess: (result) => setStage({ at: 'result', result }),
  })
  const abandon = useMutation({
    mutationFn: (grill: string) => abandonGrill(grill),
  })

  // Every pending batch is asked for at once; each lands on its own. A batch is in flight
  // at most once, whatever re-renders happen meanwhile.
  const inFlight = useRef(new Set<string>())
  const quiz = stage.at === 'quiz' ? stage : null
  const grillId = quiz?.grill.id
  const pending = quiz?.pending.join(',') ?? ''
  useEffect(() => {
    if (!grillId || !pending) return
    for (const index of pending.split(',').map(Number)) {
      const flight = `${grillId}:${index}`
      if (inFlight.current.has(flight)) continue
      inFlight.current.add(flight)
      extendGrill(grillId, index)
        .then((written) =>
          patch((draft) => {
            if (draft.stage.at !== 'quiz' || draft.stage.grill.id !== grillId)
              return draft
            const kept = draft.stage.grill.questions.filter(
              (q) => !written.some((w) => w.id === q.id),
            )
            return {
              ...draft,
              stage: {
                ...draft.stage,
                grill: {
                  ...draft.stage.grill,
                  questions: byPosition([...kept, ...written]),
                },
                pending: draft.stage.pending.filter((i) => i !== index),
              },
            }
          }),
        )
        .catch(() =>
          patch((draft) => {
            if (draft.stage.at !== 'quiz' || draft.stage.grill.id !== grillId)
              return draft
            return {
              ...draft,
              stage: {
                ...draft.stage,
                pending: draft.stage.pending.filter((i) => i !== index),
                failed: [...draft.stage.failed, index],
              },
            }
          }),
        )
        .finally(() => inFlight.current.delete(flight))
    }
    // `patch` and `user` are stable for the panel's life; the batch list is what changes.
  }, [grillId, pending])

  const byId = (id: string) => materials.data?.find((m) => m.id === id)

  if (quiz) {
    return (
      <QuizForm
        stage={quiz}
        material={byId(quiz.grill.material_id)}
        answers={answers}
        onAnswer={(question, text) =>
          patch((draft) => ({
            ...draft,
            answers: { ...draft.answers, [question]: text },
          }))
        }
        onRetry={(index) =>
          patch((draft) =>
            draft.stage.at === 'quiz'
              ? {
                  ...draft,
                  stage: {
                    ...draft.stage,
                    failed: draft.stage.failed.filter((i) => i !== index),
                    pending: [...draft.stage.pending, index],
                  },
                }
              : draft,
          )
        }
        grading={grade.isPending}
        error={grade.error?.message ?? null}
        onSubmit={(given) =>
          grade.mutate({ grill: quiz.grill.id, answers: given })
        }
        onCancel={() => {
          abandon.mutate(quiz.grill.id)
          setStage({ at: 'pick' })
        }}
      />
    )
  }
  if (stage.at === 'result') {
    return (
      <Result
        course={course}
        result={stage.result}
        material={byId(stage.result.grill.material_id)}
        onAgain={() => setStage({ at: 'pick' })}
      />
    )
  }
  return (
    <MaterialPicker
      front={front}
      materials={materials.data ?? []}
      generating={generate.isPending}
      error={generate.error?.message ?? null}
      onGrill={(material) => generate.mutate(material)}
    />
  )
}

function MaterialPicker({
  front,
  materials,
  generating,
  error,
  onGrill,
}: {
  front: TabKey | null
  materials: ReadonlyArray<Material>
  generating: boolean
  error: string | null
  onGrill: (material: string) => void
}) {
  // Null means "not chosen": the Material open in the reader, else the first one.
  const [chosen, setChosen] = useState<string | null>(null)
  const open = front ? parseTab(front) : null
  const material =
    (chosen && materials.find((m) => m.id === chosen)) ||
    (open?.kind === 'material' &&
      materials.find((m) => m.filename === open.filename)) ||
    materials.at(0)

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (material && !generating) onGrill(material.id)
      }}
    >
      <div className="space-y-1">
        <p className="text-lattice-heading font-semibold tracking-tight">
          Grill me
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          About ten questions on a whole Material, graded in one go, with a note
          on what to re-read.
        </p>
      </div>
      {materials.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          Upload a Material first; there is nothing to be grilled on yet.
        </p>
      ) : (
        <>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Material</span>
            <select
              className="w-full min-w-0 rounded-lg border border-border bg-input/30 px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
              value={material?.id ?? ''}
              onChange={(e) => setChosen(e.target.value)}
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.filename}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!material || generating}>
              {generating ? 'Planning…' : 'Grill me'}
            </Button>
          </div>
        </>
      )}
    </form>
  )
}

function scopeLine(grill: Grill, material: Material | undefined) {
  const pages =
    grill.page_end > 1 ? `${grill.page_end} pages` : `${grill.page_end} page`
  return [material?.filename, pages].filter(Boolean).join(' · ')
}

function pagesOf(batch: GrillBatch) {
  return batch.page_end > batch.page_start
    ? `pages ${batch.page_start}–${batch.page_end}`
    : `page ${batch.page_start}`
}

function QuizForm({
  stage,
  material,
  answers,
  onAnswer,
  onRetry,
  grading,
  error,
  onSubmit,
  onCancel,
}: {
  stage: Extract<Stage, { at: 'quiz' }>
  material: Material | undefined
  answers: Answers
  onAnswer: (question: string, text: string) => void
  onRetry: (batch: number) => void
  grading: boolean
  error: string | null
  onSubmit: (answers: Array<{ question: string; answer_text: string }>) => void
  onCancel: () => void
}) {
  const { grill, batches, pending, failed } = stage
  const answered = grill.questions.filter((q) => answers[q.id]?.trim()).length
  const complete =
    pending.length === 0 &&
    grill.questions.length > 0 &&
    answered === grill.questions.length
  const batch = (index: number) => batches.find((b) => b.index === index)

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (!complete || grading) return
        onSubmit(
          grill.questions.map((q) => ({
            question: q.id,
            answer_text: answers[q.id] ?? '',
          })),
        )
      }}
    >
      {/* `relative`: the radios' hidden native inputs are absolutely positioned, and
          without a positioned ancestor they anchor to the document and stretch the page. */}
      <div className="relative flex-1 overflow-y-auto px-6 py-5">
        <p className="text-lattice-heading font-semibold tracking-tight">
          {grill.topic_label}
        </p>
        <p className="text-xs text-muted-foreground">
          {scopeLine(grill, material)}
        </p>
        <ol className="mt-4 space-y-5">
          {grill.questions.map((q, i) => (
            <li key={q.id} className="space-y-2">
              <p className="text-sm font-medium">
                <span className="mr-1.5 tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                {q.prompt}
              </p>
              {q.kind === 'mcq' && q.options ? (
                <RadioGroup
                  aria-label={`Question ${i + 1}`}
                  value={answers[q.id] ?? ''}
                  onValueChange={(value) => onAnswer(q.id, value)}
                  className="gap-2"
                  disabled={grading}
                >
                  {q.options.map((option, j) => (
                    <div key={option} className="flex items-start gap-2">
                      <RadioGroupItem
                        value={option}
                        id={`${q.id}-${j}`}
                        className="mt-0.5"
                      />
                      <label htmlFor={`${q.id}-${j}`} className="text-sm">
                        {option}
                      </label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  aria-label={`Answer ${i + 1}`}
                  value={answers[q.id] ?? ''}
                  maxLength={2000}
                  disabled={grading}
                  placeholder="Your answer"
                  className="min-h-16 bg-background"
                  onChange={(e) => onAnswer(q.id, e.target.value)}
                />
              )}
            </li>
          ))}
        </ol>
        {pending.length > 0 && (
          <p
            role="status"
            className="mt-5 text-sm italic text-muted-foreground"
          >
            Writing questions for{' '}
            {pending
              .map(batch)
              .filter((b) => b !== undefined)
              .map(pagesOf)
              .join(', ')}
            …
          </p>
        )}
        {failed.map((index) => {
          const b = batch(index)
          return b ? (
            <p
              key={index}
              className="mt-3 flex items-center justify-between gap-2 text-sm text-destructive"
            >
              <span>Questions for {pagesOf(b)} could not be written.</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onRetry(index)}
              >
                Retry
              </Button>
            </p>
          ) : null
        })}
      </div>
      <div className="space-y-2 border-t border-border p-4">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <p className="text-lattice-meta text-muted-foreground">
            Answered {answered} of {grill.questions.length}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={grading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || grading}>
              {grading ? 'Grading…' : 'Submit answers'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

function Verdict({ correct }: { correct: boolean | null | undefined }) {
  const [text, tone] =
    correct === true
      ? ['Correct', 'bg-feedback-strong text-feedback-strong-text']
      : correct === false
        ? ['Incorrect', 'bg-feedback-revisit text-feedback-revisit-text']
        : ['Not graded', 'bg-muted text-muted-foreground']
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
        tone,
      )}
    >
      {text}
    </span>
  )
}

function QuestionResult({
  course,
  question,
  index,
  material,
}: {
  course: string
  question: GrillQuestion
  index: number
  material: Material | undefined
}) {
  const given = question.given
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-lattice">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lattice-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Question {index + 1}
        </span>
        <Verdict correct={given?.correct} />
      </div>
      <p className="text-sm font-medium">{question.prompt}</p>
      <dl className="space-y-1.5 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Your answer</dt>
          <dd className="whitespace-pre-wrap">{given?.text || '—'}</dd>
        </div>
        {question.key && (
          <div>
            <dt className="text-xs text-muted-foreground">Answer</dt>
            <dd>{question.key.answer}</dd>
            {question.key.explanation && (
              <dd className="text-muted-foreground">
                {question.key.explanation}
              </dd>
            )}
          </div>
        )}
        {given?.reason && given.correct !== true && (
          <div>
            <dt className="text-xs text-muted-foreground">Why</dt>
            <dd>{given.reason}</dd>
          </div>
        )}
      </dl>
      {question.page !== null && material && (
        <Link
          to="/courses/$course"
          params={{ course }}
          search={pageSearch(material.filename, {
            start: question.page,
            end: question.page,
          })}
          state={bumpJump}
          resetScroll={false}
          className="inline-block rounded-md bg-citation-context px-1.5 py-0.5 text-xs font-medium text-citation-context-text transition-opacity hover:opacity-80"
          aria-label={`${material.filename}, p. ${question.page}`}
        >
          p. {question.page}
        </Link>
      )}
    </li>
  )
}

function Result({
  course,
  result,
  material,
  onAgain,
}: {
  course: string
  result: GrillResult
  material: Material | undefined
  onAgain: () => void
}) {
  const { grill, remark } = result
  const right = grill.questions.filter((q) => q.given?.correct === true).length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div>
          <p className="text-lattice-heading font-semibold tracking-tight">
            {right} / {grill.questions.length} correct
          </p>
          <p className="text-xs text-muted-foreground">
            {[grill.topic_label, scopeLine(grill, material)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {remark && (
          <p className="rounded-xl border border-border bg-feedback-developing px-4 py-3 text-sm leading-6 text-feedback-developing-text">
            {remark}
          </p>
        )}
        <ol className="space-y-3">
          {grill.questions.map((q, i) => (
            <QuestionResult
              key={q.id}
              course={course}
              question={q}
              index={i}
              material={material}
            />
          ))}
        </ol>
      </div>
      <div className="flex justify-end border-t border-border p-4">
        <Button onClick={onAgain}>Grill me again</Button>
      </div>
    </div>
  )
}
