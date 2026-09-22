import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { QuizSetup } from '#/components/lattice/quiz-setup'
import { Textarea } from '#/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  closeQuiz,
  getQuiz,
  listQuizzes,
  listTopics,
  quizMaterials,
  recordQuizAnswer,
  usesMockBackend,
} from '#/lib/api'
import type { Enrolment } from '#/lib/api'
import type {
  MaterialOut,
  QuizAnswerOut,
  QuizOut,
  QuizQuestionOut,
  TopicOut,
} from '#/lib/generated'

const panel = 'rounded-2xl border border-border bg-card p-4 sm:p-5'
const quizName = (quiz: QuizOut) =>
  quiz.kind === 'pop' ? 'Pop quiz' : 'Grill me'
const latestAnswer = (question: QuizQuestionOut) =>
  [...question.answers].sort((a, b) => b.attempt_no - a.attempt_no)[0] as
    QuizAnswerOut | undefined
const quizKey = (user: string, course: string, id?: string) => [
  'quiz',
  course,
  user,
  id,
]

const answerDraftKey = (
  user: string,
  course: string,
  question: QuizQuestionOut,
) => `lattice.quiz-draft.${course}.${user}.${question.quiz_id}.${question.id}`

export function QuizPanel({
  course,
  user,
  quizId,
  onSelect,
  initialMaterial,
}: Enrolment & {
  quizId?: string
  initialMaterial?: string
  onSelect: (id?: string) => void
}) {
  const [tab, setTab] = useState<'practice' | 'history'>('practice')
  const quizzes = useQuery({
    queryKey: ['quizzes', course, user],
    queryFn: () => listQuizzes(user, course),
  })
  const materials = useQuery({
    queryKey: ['quiz-materials', course, user],
    queryFn: () => quizMaterials(user, course),
  })
  const selected = useQuery({
    queryKey: quizKey(user, course, quizId),
    queryFn: () => getQuiz(user, course, quizId!),
    enabled: !!quizId && !usesMockBackend(),
    retry: false,
  })
  const rows = (quizzes.data ?? []).filter((quiz) =>
    tab === 'history' ? quiz.status !== 'open' : quiz.status === 'open',
  )
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-7 sm:py-8">
      {!quizId && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Focused practice
          </p>
          <h1 className="quiz-heading text-3xl">
            {tab === 'history' ? 'Quiz history' : 'Grill this material'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Practise with questions grounded in your course’s Materials.
          </p>
        </div>
      )}
      {quizId ? (
        <>
          <Button variant="ghost" onClick={() => onSelect()}>
            ← All Quizzes
          </Button>
          {usesMockBackend() ? (
            <p>Quiz records are available in the connected app.</p>
          ) : selected.isPending ? (
            <p role="status">Loading Quiz…</p>
          ) : selected.isError ? (
            <LoadError
              error={selected.error}
              retry={() => void selected.refetch()}
            />
          ) : (
            <QuizRunner
              key={`${user}:${selected.data.id}`}
              quiz={selected.data}
              course={course}
              user={user}
              materials={materials.data ?? []}
            />
          )}
        </>
      ) : (
        <>
          <div
            role="group"
            aria-label="Quiz view"
            className="flex gap-2 border-b pb-3"
          >
            <Button
              variant={tab === 'practice' ? 'secondary' : 'ghost'}
              aria-pressed={tab === 'practice'}
              onClick={() => setTab('practice')}
            >
              Practice
            </Button>
            <Button
              variant={tab === 'history' ? 'secondary' : 'ghost'}
              aria-pressed={tab === 'history'}
              onClick={() => setTab('history')}
            >
              Quiz history
            </Button>
          </div>
          {tab === 'practice' && (
            <QuizSetup
              key={`${initialMaterial}:${materials.isSuccess}`}
              initialMaterial={initialMaterial}
              materials={materials.data ?? []}
              user={user}
              course={course}
              loading={materials.isPending}
              error={materials.error}
              retry={() => void materials.refetch()}
            />
          )}
          <section
            className="space-y-3"
            aria-label={tab === 'practice' ? 'In progress' : 'Past Quizzes'}
          >
            <h2 className="text-lg font-semibold">
              {tab === 'practice'
                ? 'Pick up where you left off'
                : 'Your past Quizzes'}
            </h2>
            {quizzes.isPending ? (
              <p role="status">Loading Quizzes…</p>
            ) : quizzes.isError ? (
              <LoadError
                error={quizzes.error}
                retry={() => void quizzes.refetch()}
              />
            ) : rows.length === 0 ? (
              <div className={`${panel} text-sm text-muted-foreground`}>
                {tab === 'practice'
                  ? 'No Quizzes in progress. Your saved Quizzes will appear here.'
                  : 'No past Quizzes yet. Finished and skipped Quizzes will appear here.'}
              </div>
            ) : (
              rows.map((quiz) => (
                <button
                  key={quiz.id}
                  onClick={() => onSelect(quiz.id)}
                  className={`${panel} flex w-full flex-wrap items-center justify-between gap-4 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring`}
                >
                  <span className="space-y-1">
                    <span className="block font-semibold">
                      {quizName(quiz)}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {quiz.questions.length} questions ·{' '}
                      {new Date(quiz.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="rounded-full bg-secondary px-3 py-1 text-sm">
                    {quiz.status === 'open'
                      ? `${quiz.questions.filter((q) => q.answers.length).length}/${quiz.questions.length} answered · Resume →`
                      : quiz.status === 'abandoned'
                        ? 'Skipped · Review →'
                        : 'Finished · Review →'}
                  </span>
                </button>
              ))
            )}
          </section>
        </>
      )}
    </div>
  )
}

function QuizRunner({
  quiz,
  user,
  course,
  materials,
}: Enrolment & { quiz: QuizOut; materials: Array<MaterialOut> }) {
  const client = useQueryClient()
  const questions = [...quiz.questions].sort((a, b) => a.position - b.position)
  const [position, setPosition] = useState(() =>
    Math.max(
      0,
      questions.findIndex((q) => !q.answers.length),
    ),
  )
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>(() => {
    const recovered: Record<string, string> = {}
    for (const q of questions) {
      try {
        const value = sessionStorage.getItem(answerDraftKey(user, course, q))
        if (value !== null) recovered[q.id] = value
      } catch {
        /* The editor reports storage failures when typing. */
      }
    }
    return recovered
  })
  const dirty = questions.some((q) => {
    const draft = drafts[q.id]
    return (
      draft !== undefined &&
      draft.trim() !== (latestAnswer(q)?.answer_text ?? '')
    )
  })
  const question = questions.at(position)
  const answered = questions.filter((q) => q.answers.length).length
  const update = (row: QuizOut) => {
    client.setQueryData(quizKey(user, course, quiz.id), row)
    void client.invalidateQueries({ queryKey: ['quizzes', course, user] })
  }
  const save = useMutation({
    mutationFn: ({
      questionId,
      answer,
    }: {
      questionId: string
      answer: string
    }) => recordQuizAnswer(user, questionId, answer),
    onSuccess: (answer) => {
      client.setQueryData<QuizOut>(
        quizKey(user, course, quiz.id),
        (prev) =>
          prev && {
            ...prev,
            questions: prev.questions.map((q) =>
              q.id === answer.question_id
                ? { ...q, answers: [...q.answers, answer] }
                : q,
            ),
          },
      )
      void client.invalidateQueries({ queryKey: ['quizzes', course, user] })
    },
  })
  const close = useMutation({
    mutationFn: (status: 'submit' | 'abandon') =>
      closeQuiz(user, quiz.id, status),
    onSuccess: (row) => {
      update(row)
      setConfirmAbandon(false)
    },
  })
  const busy = save.isPending || close.isPending
  if (quiz.status !== 'open')
    return (
      <QuizReview
        quiz={quiz}
        course={course}
        user={user}
        materials={materials}
      />
    )
  if (!question) return <p>This Quiz has no questions.</p>
  const isPop = quiz.kind === 'pop'
  const visibleQuestions = isPop ? [question] : questions
  const linkedMaterials = materials.filter((m) =>
    questions.some((q) => q.material_id === m.id),
  )
  const topicCount = new Set(questions.map((q) => q.topic_id).filter(Boolean))
    .size
  return (
    <section className="space-y-5" aria-label="Active Quiz">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <h1 className="quiz-heading text-3xl">
            {isPop ? 'Pop quiz' : 'Focused practice'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {questions.length} questions · Drafts stay in this tab
          </p>
        </div>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirmAbandon(true)}
        >
          {isPop ? 'Skip Pop quiz' : 'End Quiz early'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">
        <span className="font-medium">
          {linkedMaterials.length
            ? linkedMaterials.map((m) => m.filename).join(' · ')
            : course.toUpperCase() + ' · Practice'}
        </span>
        <span className="text-xs uppercase">
          {isPop
            ? `Question ${position + 1} of ${questions.length}`
            : topicCount
              ? `${topicCount} Topics`
              : `${answered} of ${questions.length} answers saved`}
        </span>
      </div>
      <progress
        aria-label="Quiz progress"
        max={questions.length}
        value={answered}
        className="sr-only"
      />
      {visibleQuestions.map((q) => {
        const index = questions.findIndex((item) => item.id === q.id)
        return (
          <article
            key={q.id}
            className={`${panel} quiz-question`}
            aria-label={`Question ${index + 1}`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3
                className={`whitespace-pre-wrap font-semibold leading-relaxed ${isPop ? 'text-2xl' : 'text-lg'}`}
              >
                {q.prompt}
              </h3>
            </div>
            <AnswerEditor
              question={q}
              user={user}
              course={course}
              busy={busy}
              text={drafts[q.id] ?? latestAnswer(q)?.answer_text ?? ''}
              onChange={(text) =>
                setDrafts((prev) => ({ ...prev, [q.id]: text }))
              }
              save={async (answer) => {
                await save.mutateAsync({ questionId: q.id, answer })
              }}
            />
          </article>
        )
      })}
      {save.isError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
        >
          Could not confirm your answer was saved. Your draft is kept in this
          tab. {save.error.message}{' '}
          <Button
            variant="outline"
            onClick={() => {
              save.reset()
              void client.invalidateQueries({
                queryKey: quizKey(user, course, quiz.id),
              })
            }}
          >
            Reload saved answers
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {answered} of {questions.length} answers saved
          {dirty ? ' · Unsaved changes' : ''}
        </p>
        <div className="flex gap-2">
          {isPop && (
            <Button
              variant="outline"
              disabled={busy || position === 0}
              onClick={() => {
                save.reset()
                setPosition(position - 1)
              }}
            >
              Previous
            </Button>
          )}
          {isPop && position < questions.length - 1 ? (
            <Button
              disabled={busy}
              onClick={() => {
                save.reset()
                setPosition(position + 1)
              }}
            >
              Next question →
            </Button>
          ) : (
            <Button
              disabled={busy || dirty || answered !== questions.length}
              onClick={() => close.mutate('submit')}
            >
              {close.isPending ? 'Finishing…' : 'Finish Quiz'}
            </Button>
          )}
        </div>
      </div>
      {answered !== questions.length && (
        <p className="text-sm text-muted-foreground">
          Save an answer to every question before finishing.
        </p>
      )}
      {dirty && answered === questions.length && (
        <p className="text-sm text-muted-foreground">
          Save changed answers before finishing.
        </p>
      )}
      {close.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not finish the Quiz: {close.error.message}
        </p>
      )}
      <Dialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {quiz.kind === 'pop'
                ? 'Skip this Pop quiz?'
                : 'End this Quiz early?'}
            </DialogTitle>
            <DialogDescription>
              Your saved answers will stay in Quiz history. You won’t be able to
              add more answers to this Quiz.
            </DialogDescription>
          </DialogHeader>
          {close.isError && <p role="alert">{close.error.message}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmAbandon(false)}
            >
              Keep practising
            </Button>
            <Button disabled={busy} onClick={() => close.mutate('abandon')}>
              {close.isPending ? 'Ending…' : 'End Quiz'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function AnswerEditor({
  question,
  user,
  course,
  busy,
  save,
  text,
  onChange,
}: Enrolment & {
  question: QuizQuestionOut
  busy: boolean
  save: (answer: string) => Promise<void>
  text: string
  onChange: (value: string) => void
}) {
  const previous = latestAnswer(question)
  const draftKey = answerDraftKey(user, course, question)
  const [storageFailed, setStorageFailed] = useState(false)
  const change = (value: string) => {
    onChange(value)
    try {
      sessionStorage.setItem(draftKey, value)
    } catch {
      setStorageFailed(true)
    }
  }
  const saved = previous?.answer_text === text.trim()
  return (
    <div className="mt-6 space-y-4">
      {question.kind === 'mcq' ? (
        <fieldset disabled={busy} className="space-y-3">
          <legend className="mb-3 text-sm font-medium">Choose an answer</legend>
          {(question.options_json ?? []).map((option, i) => (
            <label
              key={i}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm ${text === option ? 'border-primary bg-secondary' : ''}`}
            >
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={text === option}
                onChange={() => change(option)}
              />
              <span>{option}</span>
            </label>
          ))}
          {!question.options_json?.length && (
            <p role="alert">Answer options are missing for this question.</p>
          )}
        </fieldset>
      ) : (
        <label className="block space-y-2 text-sm font-medium">
          <span>Your answer</span>
          <Textarea
            rows={3}
            maxLength={10000}
            value={text}
            disabled={busy}
            placeholder="Explain it in your own words…"
            onChange={(e) => change(e.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || !text.trim() || saved}
          onClick={async () => {
            try {
              await save(text.trim())
              sessionStorage.removeItem(draftKey)
            } catch {
              /* The parent displays the API error; keep the draft. */
            }
          }}
        >
          {busy
            ? 'Saving…'
            : previous && !saved
              ? 'Save another attempt'
              : 'Save answer'}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            Answer saved{previous.correct === null ? ' · not graded yet' : ''}
          </p>
        )}
      </div>
      {storageFailed && (
        <p role="alert" className="text-sm text-destructive">
          This browser couldn’t keep your draft. Save your answer before
          leaving.
        </p>
      )}
      {previous && <AnswerFeedback answer={previous} />}
    </div>
  )
}

function AnswerFeedback({ answer }: { answer: QuizAnswerOut }) {
  const explanation =
    answer.feedback_json?.explanation ?? answer.feedback_json?.text
  return (
    <div
      className={`rounded-xl p-4 text-sm ${answer.correct === true ? 'bg-feedback-strong text-feedback-strong-text' : answer.correct === false ? 'bg-feedback-revisit text-feedback-revisit-text' : 'bg-muted text-muted-foreground'}`}
    >
      <p className="font-medium">
        {answer.correct === true
          ? 'Correct'
          : answer.correct === false
            ? 'Revisit this answer'
            : 'Awaiting feedback'}
      </p>
      {typeof explanation === 'string' && (
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">
          {explanation}
        </p>
      )}
      {answer.correct === null && (
        <p className="mt-1">
          Your answer is recorded. Automatic grading is not available yet.
        </p>
      )}
    </div>
  )
}

function QuizReview({
  quiz,
  course,
  user,
  materials,
}: Enrolment & { quiz: QuizOut; materials: Array<MaterialOut> }) {
  const materialIds = [
    ...new Set(
      quiz.questions
        .map((q) => q.material_id)
        .filter((id): id is string => !!id),
    ),
  ].sort()
  const topics = useQuery({
    queryKey: ['quiz-review-topics', course, user, materialIds],
    queryFn: async () =>
      (await Promise.all(materialIds.map((id) => listTopics(user, id)))).flat(),
  })
  const questions = [...quiz.questions].sort((a, b) => a.position - b.position)
  const answers = questions
    .map(latestAnswer)
    .filter((a): a is QuizAnswerOut => !!a)
  const ungraded = answers.filter((a) => a.correct === null).length
  const groups = new Map<string | null, Array<QuizQuestionOut>>()
  for (const q of questions)
    groups.set(q.topic_id, [...(groups.get(q.topic_id) ?? []), q])
  const topicLabel = (id: string | null) =>
    topics.data?.find((t: TopicOut) => t.id === id)?.label ??
    (id ? 'Topic unavailable' : 'Other questions')
  return (
    <section className="space-y-6" aria-label="Quiz review">
      <div
        className={
          quiz.kind === 'pop'
            ? 'space-y-3 rounded-2xl bg-secondary p-6'
            : 'space-y-3'
        }
      >
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
          {quizName(quiz)}
        </span>
        <h2 className="quiz-heading text-3xl">
          {quiz.status === 'abandoned'
            ? 'Quiz ended early'
            : 'You’ve finished this Quiz'}
        </h2>
        <p className="text-muted-foreground">
          {answers.length} of {questions.length} questions answered
          {ungraded ? ` · ${ungraded} awaiting feedback` : ''}
        </p>
        <p className="text-sm font-semibold text-primary">
          {quiz.score === null
            ? 'Not scored'
            : `${Math.round(quiz.score * 100)}%`}
        </p>
        {quiz.score === null && (
          <p className="text-sm text-muted-foreground">
            This Quiz has no recorded score.
          </p>
        )}
      </div>
      <div>
        <h3 className="quiz-heading mb-4 text-xl">Your Topics at a glance</h3>
        {topics.isError && (
          <p className="mb-3 text-sm text-muted-foreground">
            Topic names could not be loaded.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {[...groups].map(([id, group], i) => {
            const latest = group.map(latestAnswer)
            return (
              <div
                key={id ?? 'other'}
                className="space-y-4 rounded-2xl border bg-card p-5"
              >
                <span className="inline-block rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                  {latest.some((a) => a?.correct === null)
                    ? 'Awaiting feedback'
                    : latest.some((a) => !a)
                      ? 'Incomplete'
                      : latest.every((a) => a?.correct === true)
                        ? 'Strong'
                        : latest.every((a) => a?.correct === false)
                          ? 'Revisit'
                          : 'Developing'}
                </span>
                <h4 className="quiz-heading text-xl">
                  {topicLabel(id)}
                  {id && !topics.data?.some((t) => t.id === id)
                    ? ` ${i + 1}`
                    : ''}
                </h4>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {latest.filter((a) => a?.correct === true).length} correct ·{' '}
                  {latest.filter((a) => a?.correct === false).length} to revisit
                  · {latest.filter((a) => a && a.correct === null).length}{' '}
                  ungraded · {latest.filter((a) => !a).length} unanswered
                </p>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-secondary p-5">
        <div>
          <p className="text-xs font-semibold uppercase text-secondary-foreground">
            ✓ Attempt saved
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {quiz.submitted_at
              ? new Date(quiz.submitted_at).toLocaleString()
              : 'Available in Quiz history'}
          </p>
        </div>
        <Button asChild>
          <Link
            to="/courses/$course"
            params={{ course }}
            search={{
              material: materials.find((m) =>
                questions.some((q) => q.material_id === m.id),
              )?.filename,
            }}
          >
            Continue studying
          </Link>
        </Button>
      </div>
      <h3 className="quiz-heading text-xl">Review your answers</h3>
      {questions.map((q, i) => {
        const answer = latestAnswer(q)
        const material = materials.find((m) => m.id === q.material_id)
        return (
          <article key={q.id} className={`${panel} space-y-4`}>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Question {i + 1}
            </p>
            <h4 className="whitespace-pre-wrap font-medium">{q.prompt}</h4>
            <p className="whitespace-pre-wrap text-sm">
              <span className="font-semibold">Your answer: </span>
              {answer?.answer_text ?? 'Not answered'}
            </p>
            {answer && <AnswerFeedback answer={answer} />}
            {material && (
              <Link
                to={
                  material.filename.toLowerCase().endsWith('.pdf')
                    ? '/courses/$course'
                    : '/courses/$course/materials'
                }
                params={{ course }}
                search={{ material: material.filename }}
                className="inline-block break-all text-sm font-medium underline underline-offset-4"
              >
                Revisit {material.filename}
              </Link>
            )}
          </article>
        )
      })}
    </section>
  )
}

function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 p-4 text-sm"
    >
      <p>Couldn’t load this content: {error.message}</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}
