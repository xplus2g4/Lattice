import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'
import { renderRoute } from '#/test/render'
import { server } from '#/test/server'
import type { QuizOut, RecordAnswer } from '#/lib/generated'

function quizFixture(): QuizOut {
  return {
    id: 'quiz-1',
    course_id: 'course-1',
    kind: 'grill',
    status: 'open',
    score: null,
    scope_json: {},
    created_at: '2026-09-22T00:00:00Z',
    submitted_at: null,
    questions: [
      {
        id: 'q1',
        quiz_id: 'quiz-1',
        position: 0,
        kind: 'short_answer',
        prompt: 'Explain a cache hit.',
        topic_id: null,
        material_id: null,
        options_json: null,
        expected_json: { answer: 'Do not reveal this before submission' },
        citation_json: null,
        answers: [],
      },
      {
        id: 'q2',
        quiz_id: 'quiz-1',
        position: 1,
        kind: 'mcq',
        prompt: 'Which memory is volatile?',
        topic_id: null,
        material_id: null,
        options_json: ['RAM', 'ROM'],
        expected_json: null,
        citation_json: null,
        answers: [],
      },
    ],
  }
}

function serveQuiz(quiz = quizFixture()) {
  const requests: Array<RecordAnswer> = []
  const closures: Array<Record<string, unknown>> = []
  server.use(
    http.get('*/courses.get', () => HttpResponse.json({ id: 'course-1' })),
    http.get('*/quizzes.list', ({ request }) => {
      expect(request.headers.get('X-User')).toBe('alice@example.com')
      expect(new URL(request.url).searchParams.get('course')).toBe('cs2100')
      return HttpResponse.json([quiz])
    }),
    http.get('*/quizzes.get', () => HttpResponse.json(quiz)),
    http.post('*/quizAnswers.record', async ({ request }) => {
      const body = (await request.json()) as RecordAnswer
      requests.push(body)
      const question = quiz.questions.find((q) => q.id === body.question)!
      const answer = {
        id: `answer-${requests.length}`,
        question_id: question.id,
        attempt_no: question.answers.length + 1,
        answer_text: body.answer_text,
        correct: null,
        feedback_json: null,
        created_at: '2026-09-22T00:00:00Z',
      }
      question.answers.push(answer)
      return HttpResponse.json(answer, { status: 201 })
    }),
    ...(['submit', 'abandon'] as const).map((action) =>
      http.post(`*/quizzes.${action}`, async ({ request }) => {
        closures.push((await request.json()) as Record<string, unknown>)
        quiz.status = action === 'submit' ? 'submitted' : 'abandoned'
        return HttpResponse.json(quiz)
      }),
    ),
  )
  return { quiz, requests, closures }
}

it('saves both answer formats, resumes after reload, and finishes without inventing grades', async () => {
  const { requests, closures } = serveQuiz()
  const user = userEvent.setup()
  const first = renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  expect(
    await screen.findByRole(
      'article',
      { name: 'Question 2' },
      { timeout: 5000 },
    ),
  ).toBeInTheDocument()
  await user.type(
    await screen.findByRole('textbox', { name: 'Your answer' }),
    'The requested data is already cached.',
  )
  expect(
    screen.queryByText('Do not reveal this before submission'),
  ).not.toBeInTheDocument()
  await user.click(
    within(screen.getByRole('article', { name: 'Question 1' })).getByRole(
      'button',
      { name: 'Save answer' },
    ),
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Answer saved · not graded yet',
  )
  first.unmount()
  renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  await user.click(await screen.findByRole('radio', { name: 'RAM' }))
  expect(screen.getByRole('button', { name: 'Finish Quiz' })).toBeDisabled()
  await user.click(
    within(screen.getByRole('article', { name: 'Question 2' })).getByRole(
      'button',
      { name: 'Save answer' },
    ),
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Finish Quiz' })).toBeEnabled(),
  )
  await user.click(screen.getByRole('button', { name: 'Finish Quiz' }))
  expect(
    await screen.findByRole('heading', { name: 'You’ve finished this Quiz' }),
  ).toBeInTheDocument()
  expect(screen.getByText('Not scored')).toBeInTheDocument()
  expect(
    screen.getByText('0 correct · 0 to revisit · 2 ungraded · 0 unanswered'),
  ).toBeInTheDocument()
  expect(requests).toEqual([
    { question: 'q1', answer_text: 'The requested data is already cached.' },
    { question: 'q2', answer_text: 'RAM' },
  ])
  expect(closures).toEqual([{ quiz: 'quiz-1' }])
}, 10000)

it('keeps a failed answer draft across reload and isolates it from another user', async () => {
  const { requests } = serveQuiz()
  server.use(
    http.post('*/quizAnswers.record', () =>
      HttpResponse.json({ detail: 'Connection interrupted' }, { status: 503 }),
    ),
  )
  const user = userEvent.setup()
  const first = renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  await user.type(
    await screen.findByRole('textbox', { name: 'Your answer' }),
    'My unsaved explanation',
  )
  await user.click(
    within(screen.getByRole('article', { name: 'Question 1' })).getByRole(
      'button',
      { name: 'Save answer' },
    ),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not confirm your answer was saved',
  )
  first.unmount()
  const second = renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  expect(
    await screen.findByRole('textbox', { name: 'Your answer' }),
  ).toHaveValue('My unsaved explanation')
  expect(requests).toHaveLength(0)
  second.unmount()
  localStorage.setItem('lattice.user', 'bob@example.com')
  server.use(http.get('*/quizzes.list', () => HttpResponse.json([])))
  renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  expect(
    await screen.findByRole('textbox', { name: 'Your answer' }),
  ).toHaveValue('')
})

it('confirms skipping a Pop quiz and preserves it in history', async () => {
  const quiz = quizFixture()
  quiz.kind = 'pop'
  const { closures } = serveQuiz(quiz)
  const user = userEvent.setup()
  renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  await user.click(await screen.findByRole('button', { name: 'Skip Pop quiz' }))
  expect(closures).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Keep practising' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Skip Pop quiz' }))
  await user.click(screen.getByRole('button', { name: 'End Quiz' }))
  expect(
    await screen.findByRole('region', { name: 'Quiz review' }),
  ).toHaveTextContent('Not answered')
  await user.click(screen.getByRole('button', { name: /All Quizzes/ }))
  await user.click(screen.getByRole('button', { name: 'Quiz history' }))
  expect(
    await screen.findByRole('button', { name: /Pop quiz.*Skipped/ }),
  ).toBeInTheDocument()
  expect(closures).toHaveLength(1)
})

it('offers Material and Topic selection while generation is unavailable', async () => {
  serveQuiz()
  server.use(
    http.get('*/materials.list', () =>
      HttpResponse.json([
        { id: 'm1', filename: 'Memory.pdf', status: 'ready' },
        { id: 'm2', filename: 'Queued.pdf', status: 'queued' },
      ]),
    ),
    http.get('*/topics.list', ({ request }) => {
      expect(new URL(request.url).searchParams.get('material')).toBe('m1')
      return HttpResponse.json([
        {
          id: 't1',
          material_id: 'm1',
          label: 'Caching',
          page_start: 3,
          page_end: 9,
          position: 0,
        },
      ])
    }),
  )
  const user = userEvent.setup()
  renderRoute('/courses/cs2100/quizzes')
  await screen.findByRole('option', { name: 'Memory.pdf' })
  expect(
    screen.getByRole('option', { name: 'Queued.pdf (not ready)' }),
  ).toBeDisabled()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Material' }),
    'm1',
  )
  await user.click(await screen.findByRole('checkbox', { name: /Caching/ }))
  expect(screen.getByText('1 Topics selected')).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'Selected Pages' }))
  expect(screen.getByRole('checkbox', { name: /Caching/ })).not.toBeChecked()
  const start = screen.getByRole('spinbutton', { name: 'From Page' })
  const end = screen.getByRole('spinbutton', { name: 'To Page' })
  await user.clear(start)
  await user.type(start, '5')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose a valid Page range',
  )
  await user.clear(end)
  await user.type(end, '8')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByText('Pages 5–8')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start Grill me' })).toBeDisabled()
  expect(
    screen.getByText(/New Quiz generation is coming soon/),
  ).toBeInTheDocument()
})

it('does not show a Quiz opened under the wrong course', async () => {
  const quiz = quizFixture()
  quiz.course_id = 'another-course'
  serveQuiz(quiz)
  renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'no such quiz in this course',
  )
  expect(screen.queryByText('Explain a cache hit.')).not.toBeInTheDocument()
})

it('opens Practice from the persistent sidebar', async () => {
  serveQuiz()
  const user = userEvent.setup()
  const { router } = renderRoute('/courses/cs2100')
  await user.click(await screen.findByRole('link', { name: 'Practice' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/courses/cs2100/quizzes'),
  )
  expect(
    await screen.findByRole('heading', {
      name: 'What would you like to practise?',
    }),
  ).toBeInTheDocument()
})

it('requires edited answers to be saved before finishing and keeps repeated attempts', async () => {
  const quiz = quizFixture()
  quiz.questions = [quiz.questions[0]]
  quiz.questions[0].answers = [
    {
      id: 'old',
      question_id: 'q1',
      attempt_no: 1,
      answer_text: 'Original answer',
      correct: null,
      feedback_json: null,
      created_at: quiz.created_at,
    },
  ]
  const { requests } = serveQuiz(quiz)
  const user = userEvent.setup()
  renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  const input = await screen.findByRole('textbox', { name: 'Your answer' })
  expect(screen.getByRole('button', { name: 'Finish Quiz' })).toBeEnabled()
  await user.clear(input)
  await user.type(input, 'Improved answer')
  expect(screen.getByRole('button', { name: 'Finish Quiz' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save another attempt' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Finish Quiz' })).toBeEnabled(),
  )
  expect(quiz.questions[0].answers).toHaveLength(2)
  expect(requests).toEqual([{ question: 'q1', answer_text: 'Improved answer' }])
})

it('shows recorded grades and readable feedback in a finished Quiz', async () => {
  const quiz = quizFixture()
  quiz.status = 'submitted'
  quiz.score = 0.5
  quiz.questions[0].answers = [
    {
      id: 'a1',
      question_id: 'q1',
      attempt_no: 1,
      answer_text: 'In the cache',
      correct: true,
      feedback_json: { explanation: 'The data was found in the cache.' },
      created_at: quiz.created_at,
    },
  ]
  quiz.questions[1].answers = [
    {
      id: 'a2',
      question_id: 'q2',
      attempt_no: 1,
      answer_text: 'ROM',
      correct: false,
      feedback_json: {
        explanation: 'RAM loses its contents when power is removed.',
      },
      created_at: quiz.created_at,
    },
  ]
  serveQuiz(quiz)
  renderRoute('/courses/cs2100/quizzes?quiz=quiz-1')
  expect(await screen.findByText('50%')).toBeInTheDocument()
  expect(
    screen.getByText('1 correct · 1 to revisit · 0 ungraded · 0 unanswered'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('RAM loses its contents when power is removed.'),
  ).toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: 'Quiz review' })).queryByRole(
      'textbox',
    ),
  ).not.toBeInTheDocument()
})
