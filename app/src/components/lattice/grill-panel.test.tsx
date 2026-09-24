import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { grill, grillQuestion, material } from '#/test/fixtures'
import { grillNextWith, resetStore, store } from '#/test/handlers'
import { renderRoute } from '#/test/render'
import { server } from '#/test/server'

const ALICE = 'alice@example.com'

async function openGrillTab(path = '/courses/cs101?material=week1.pdf') {
  const user = userEvent.setup()
  renderRoute(path)
  await user.click(await screen.findByRole('tab', { name: /Grill/ }))
  return user
}

describe('choosing what to be grilled on', () => {
  it('defaults to the open Material and where the reader stopped', async () => {
    resetStore({
      materials: [
        material({ id: 'm1', filename: 'week1.pdf' }),
        material({ id: 'm2', filename: 'week2.pdf' }),
      ],
    })
    localStorage.setItem(
      `lattice.reading:${ALICE}:cs101`,
      JSON.stringify({ 'material:week2.pdf': 7 }),
    )
    await openGrillTab('/courses/cs101?material=week2.pdf')

    const picker = screen.getByRole('combobox', { name: 'Material' })
    await waitFor(() => expect(picker).toHaveValue('m2'))
    expect(screen.getByRole('spinbutton', { name: 'From page' })).toHaveValue(1)
    expect(screen.getByRole('spinbutton', { name: 'To page' })).toHaveValue(7)
  })

  it('follows the chosen Material and refuses a backwards range', async () => {
    resetStore({
      materials: [
        material({ id: 'm1', filename: 'week1.pdf' }),
        material({ id: 'm2', filename: 'week2.pdf' }),
      ],
    })
    localStorage.setItem(
      `lattice.reading:${ALICE}:cs101`,
      JSON.stringify({ 'material:week1.pdf': 3, 'material:week2.pdf': 12 }),
    )
    const user = await openGrillTab()
    const to = screen.getByRole('spinbutton', { name: 'To page' })
    await waitFor(() => expect(to).toHaveValue(3))

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Material' }),
      'm2',
    )
    await waitFor(() => expect(to).toHaveValue(12))

    await user.clear(screen.getByRole('spinbutton', { name: 'From page' }))
    await user.type(screen.getByRole('spinbutton', { name: 'From page' }), '20')
    expect(screen.getByText(/in order/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grill me' })).toBeDisabled()
  })

  it('says so when the course has no Materials', async () => {
    resetStore()
    await openGrillTab('/courses/cs101')

    expect(screen.getByText(/nothing to be grilled on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grill me' })).toBeNull()
  })
})

describe('a grill', () => {
  it('asks, waits for every answer, grades, and links each question to its Page', async () => {
    resetStore({ materials: [material({ id: 'm1', filename: 'week1.pdf' })] })
    const user = await openGrillTab()

    await user.click(screen.getByRole('button', { name: 'Grill me' }))

    expect(
      await screen.findByText('What resolves a collision?'),
    ).toBeInTheDocument()
    expect(screen.getByText('Hash collisions')).toBeInTheDocument()
    expect(screen.getByText('week1.pdf · p. 1')).toBeInTheDocument()
    // The key never reaches the form.
    expect(document.body).not.toHaveTextContent(
      'Chaining keeps colliding keys in one bucket.',
    )
    const submit = screen.getByRole('button', { name: 'Submit answers' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('Answered 0 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Sorting' }))
    expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument()
    expect(submit).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', { name: 'Answer 2' }),
      'two keys, one bucket',
    )
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(await screen.findByText('1 / 2 correct')).toBeInTheDocument()
    expect(
      screen.getByText('Re-read p. 3 on hash collisions before moving on.'),
    ).toBeInTheDocument()
    const first = screen.getByText('What resolves a collision?').closest('li')!
    expect(within(first).getByText('Incorrect')).toBeInTheDocument()
    expect(within(first).getByText('Sorting')).toBeInTheDocument()
    expect(within(first).getByText('Chaining')).toBeInTheDocument()
    expect(
      within(first).getByText('Chaining keeps colliding keys in one bucket.'),
    ).toBeInTheDocument()
    expect(
      within(first).getByText('The correct option is: Chaining'),
    ).toBeInTheDocument()
    expect(
      within(first)
        .getByRole('link', { name: 'week1.pdf, p. 3' })
        .getAttribute('href'),
    ).toBe('/courses/cs101?material=week1.pdf&page=3')
    const second = screen.getByText('Define a hash collision.').closest('li')!
    expect(within(second).getByText('Correct')).toBeInTheDocument()
    expect(
      within(second).getByText('Two keys hash to the same bucket.'),
    ).toBeInTheDocument()
    expect(store.grills['grill-1']?.grill.status).toBe('submitted')

    await user.click(screen.getByRole('button', { name: 'Grill me again' }))
    expect(screen.getByRole('button', { name: 'Grill me' })).toBeInTheDocument()
  })

  it('shows an ungraded short answer as such', async () => {
    resetStore({ materials: [material({ id: 'm1', filename: 'week1.pdf' })] })
    grillNextWith(
      grill({
        questions: [
          grillQuestion({
            id: 'q1',
            kind: 'short_answer',
            prompt: 'Why chain?',
            options: null,
          }),
        ],
      }),
    )
    server.use(
      http.post('*/quizzes.grade', ({ request }) =>
        (async () => {
          const body = (await request.json()) as { quiz: string }
          const found = store.grills[body.quiz]!
          const graded = {
            ...found.grill,
            status: 'submitted' as const,
            score: 0,
            questions: found.grill.questions.map((q) => ({
              ...q,
              given: { text: 'hmm', correct: null, reason: 'Not graded.' },
            })),
          }
          return HttpResponse.json({
            quiz: {
              id: graded.id,
              course_id: 'c',
              kind: 'grill',
              scope_json: {
                material_id: graded.material_id,
                page_start: 1,
                page_end: 1,
                topic_label: graded.topic_label,
              },
              status: 'submitted',
              score: 0,
              created_at: '2026-01-01T00:00:00Z',
              submitted_at: '2026-01-01T00:00:00Z',
              questions: graded.questions.map((q, position) => ({
                id: q.id,
                quiz_id: graded.id,
                topic_id: null,
                material_id: graded.material_id,
                position,
                kind: q.kind,
                prompt: q.prompt,
                options_json: null,
                expected_json: { answer: q.key?.answer, explanation: null },
                citation_json: null,
                answers: [
                  {
                    id: 'a',
                    question_id: q.id,
                    attempt_no: 1,
                    answer_text: 'hmm',
                    correct: null,
                    feedback_json: { reason: 'Not graded.' },
                    created_at: '2026-01-01T00:00:00Z',
                  },
                ],
              })),
            },
            remark: '',
          })
        })(),
      ),
    )
    const user = await openGrillTab()
    await user.click(screen.getByRole('button', { name: 'Grill me' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Answer 1' }),
      'hmm',
    )
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await screen.findByText('0 / 1 correct')).toBeInTheDocument()
    expect(screen.getByText('Not graded')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /p\. / })).toBeNull()
  })

  it('keeps the form when grading fails, and abandons it on cancel', async () => {
    resetStore({ materials: [material({ id: 'm1', filename: 'week1.pdf' })] })
    server.use(
      http.post('*/quizzes.grade', () =>
        HttpResponse.json(
          { detail: 'Answers could not be graded; please retry' },
          { status: 502 },
        ),
      ),
    )
    const user = await openGrillTab()
    await user.click(screen.getByRole('button', { name: 'Grill me' }))
    await user.click(await screen.findByRole('radio', { name: 'Chaining' }))
    await user.type(screen.getByRole('textbox', { name: 'Answer 2' }), 'bucket')
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await screen.findByText(/could not be graded/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Answer 2' })).toHaveValue(
      'bucket',
    )
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Grill me' })).toBeInTheDocument()
    await waitFor(() =>
      expect(store.grills['grill-1']?.grill.status).toBe('abandoned'),
    )
  })

  it('reports a failed generation and lets the student try again', async () => {
    resetStore({ materials: [material({ id: 'm1', filename: 'week1.pdf' })] })
    server.use(
      http.post('*/quizzes.generate', () =>
        HttpResponse.json(
          { detail: 'The model wrote no usable questions; please retry' },
          { status: 502 },
        ),
      ),
    )
    const user = await openGrillTab()
    await user.click(screen.getByRole('button', { name: 'Grill me' }))

    expect(await screen.findByText(/no usable questions/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grill me' })).toBeEnabled()
  })

  it('survives a switch to Ask and back', async () => {
    resetStore({ materials: [material({ id: 'm1', filename: 'week1.pdf' })] })
    const user = await openGrillTab()
    await user.click(screen.getByRole('button', { name: 'Grill me' }))
    await user.click(await screen.findByRole('radio', { name: 'Chaining' }))

    await user.click(screen.getByRole('tab', { name: /Ask/ }))
    expect(screen.queryByRole('radio', { name: 'Chaining' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: /Grill/ }))
    expect(screen.getByRole('radio', { name: 'Chaining' })).toBeChecked()
    expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument()
  })
})
