import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { bumpJump, pageSearch } from '#/components/lattice/answer'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { Textarea } from '#/components/ui/textarea'
import {
  abandonGrill,
  generateGrill,
  gradeGrill,
  listMaterials,
} from '#/lib/api'
import { readingPosition } from '#/lib/reading-position'
import { useStored } from '#/lib/storage'
import { materialTab, parseTab } from '#/lib/tabs'
import { cn } from '#/lib/utils'

import type {
  Enrolment,
  Grill,
  GrillQuestion,
  GrillResult,
  GrillScope,
  Material,
} from '#/lib/api'
import type { TabKey } from '#/lib/tabs'

/** The server refuses more than this many pages in one Grill (lattice/quiz.py). */
const MAX_PAGES = 40

// Three stages, one at a time: choose a scope, answer the questions, read the result.
// The Grill itself lives on the server from the moment it is written; this state is only
// which of its views is on screen.
type Stage =
  | { at: 'pick' }
  | { at: 'quiz'; grill: Grill }
  | { at: 'result'; result: GrillResult }

type Answers = Partial<Record<string, string>>
interface Draft {
  stage: Stage
  answers: Answers
}

const FRESH: Draft = { stage: { at: 'pick' }, answers: {} }

// The panel unmounts whenever Ask or History is in front, so what the student was doing
// is kept in localStorage, per course and user, and picked up again when the Grill tab
// returns, or after a reload. The Grill itself is on the server from the moment it is
// written; this is only which of its views is on screen and what has been typed.
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

export function GrillPanel({
  course,
  user,
  front,
}: Enrolment & { front: TabKey | null }) {
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(user, course),
  })
  const [stored, setStored] = useStored(`lattice.grill:${course}:${user}`, '')
  const { stage, answers } = useMemo(() => parseDraft(stored), [stored])
  const update = (next: Draft) => setStored(JSON.stringify(next))
  const setStage = (next: Stage) => update({ stage: next, answers: {} })
  const generate = useMutation({
    mutationFn: (scope: GrillScope) => generateGrill(user, course, scope),
    onSuccess: (grill) => setStage({ at: 'quiz', grill }),
  })
  const grade = useMutation({
    mutationFn: (input: {
      grill: string
      answers: Array<{ question: string; answer_text: string }>
    }) => gradeGrill(user, input.grill, input.answers),
    onSuccess: (result) => setStage({ at: 'result', result }),
  })
  const abandon = useMutation({
    mutationFn: (grill: string) => abandonGrill(user, grill),
  })
  const byId = (id: string) => materials.data?.find((m) => m.id === id)

  if (stage.at === 'quiz') {
    return (
      <QuizForm
        grill={stage.grill}
        material={byId(stage.grill.material_id)}
        answers={answers}
        onAnswer={(question, text) =>
          update({ stage, answers: { ...answers, [question]: text } })
        }
        grading={grade.isPending}
        error={grade.error?.message ?? null}
        onSubmit={(given) =>
          grade.mutate({ grill: stage.grill.id, answers: given })
        }
        onCancel={() => {
          abandon.mutate(stage.grill.id)
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
    <ScopePicker
      course={course}
      user={user}
      front={front}
      materials={materials.data ?? []}
      generating={generate.isPending}
      error={generate.error?.message ?? null}
      onGrill={(scope) => generate.mutate(scope)}
    />
  )
}

function ScopePicker({
  course,
  user,
  front,
  materials,
  generating,
  error,
  onGrill,
}: Enrolment & {
  front: TabKey | null
  materials: ReadonlyArray<Material>
  generating: boolean
  error: string | null
  onGrill: (scope: GrillScope) => void
}) {
  // Null means "not chosen": the open Material, else the first one. Pages follow the
  // Material, so choosing another resets them to its defaults.
  const [chosen, setChosen] = useState<string | null>(null)
  const [pages, setPages] = useState<{ from: string; to: string } | null>(null)
  const open = front ? parseTab(front) : null
  const material =
    (chosen && materials.find((m) => m.id === chosen)) ||
    (open?.kind === 'material' &&
      materials.find((m) => m.filename === open.filename)) ||
    materials.at(0)
  // Read here rather than during render: where the reader stopped is in localStorage,
  // which the server render cannot see.
  useEffect(() => {
    if (pages !== null || !material) return
    const at = readingPosition(user, course, materialTab(material.filename))
    setPages({ from: '1', to: String(at ?? 1) })
  }, [pages, material, user, course])

  const from = Number(pages?.from)
  const to = Number(pages?.to)
  const valid =
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 1 &&
    to >= from &&
    to - from < MAX_PAGES
  const field =
    'w-full min-w-0 rounded-lg border border-border bg-input/30 px-3 py-2 text-sm outline-none transition-colors focus:border-ring'

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (material && valid && !generating)
          onGrill({ material: material.id, page_start: from, page_end: to })
      }}
    >
      <div className="space-y-1">
        <p className="text-lattice-heading font-semibold tracking-tight">
          Grill me
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          Up to ten questions on the pages you choose, graded in one go, with a
          note on what to re-read.
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
              className={field}
              value={material?.id ?? ''}
              onChange={(e) => {
                setChosen(e.target.value)
                setPages(null)
              }}
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.filename}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">From page</span>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={pages?.from ?? ''}
                onChange={(e) =>
                  setPages({ from: e.target.value, to: pages?.to ?? '' })
                }
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">To page</span>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={pages?.to ?? ''}
                onChange={(e) =>
                  setPages({ from: pages?.from ?? '', to: e.target.value })
                }
              />
            </label>
          </div>
          {pages && !valid && (
            <p className="text-xs text-destructive">
              Pages must be whole numbers, in order, and at most {MAX_PAGES} at
              a time.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={!material || !valid || generating}>
              {generating ? 'Writing questions…' : 'Grill me'}
            </Button>
          </div>
        </>
      )}
    </form>
  )
}

function scopeLine(grill: Grill, material: Material | undefined) {
  const pages =
    grill.page_end > grill.page_start
      ? `p. ${grill.page_start}–${grill.page_end}`
      : `p. ${grill.page_start}`
  return [material?.filename, pages].filter(Boolean).join(' · ')
}

function QuizForm({
  grill,
  material,
  answers,
  onAnswer,
  grading,
  error,
  onSubmit,
  onCancel,
}: {
  grill: Grill
  material: Material | undefined
  answers: Answers
  onAnswer: (question: string, text: string) => void
  grading: boolean
  error: string | null
  onSubmit: (answers: Array<{ question: string; answer_text: string }>) => void
  onCancel: () => void
}) {
  const answered = grill.questions.filter((q) => answers[q.id]?.trim()).length
  const complete = answered === grill.questions.length

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
      <div className="flex-1 overflow-y-auto px-6 py-5">
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
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
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
      <div className="border-t border-border p-4">
        <Button onClick={onAgain}>Grill me again</Button>
      </div>
    </div>
  )
}
