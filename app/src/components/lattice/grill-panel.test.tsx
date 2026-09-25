import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { grill, grillQuestion, material } from '#/test/fixtures'
import {
  failBatch,
  gradeNextGrillWith,
  grillNextWith,
  holdBatch,
  resetStore,
  store,
} from '#/test/handlers'
import { renderRoute } from '#/test/render'
import { server } from '#/test/server'

async function openGrillTab(path = '/courses/cs101?material=week1.pdf') {
  const user = userEvent.setup()
  renderRoute(path)
  await user.click(await screen.findByRole('tab', { name: /Grill/ }))
  return user
}

/** Plans a Grill and waits until both batches are on the form. */
async function startGrill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Grill me' }))
  await screen.findByText('What resolves a collision?')
  await screen.findByText('Define a hash collision.')
  await waitFor(() =>
    expect(screen.queryByText(/Writing questions/)).toBeNull(),
  )
}

describe('choosing what to be grilled on', () => {
  it('defaults to the Material open in the reader', async () => {
    resetStore({
      materials: [
        material({ filename: 'week1.pdf' }),
        material({ filename: 'week2.pdf' }),
      ],
    })
    await openGrillTab('/courses/cs101?material=week2.pdf')

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Material' })).toHaveValue(
        'm-week2.pdf',
      ),
    )
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('falls back to the first Material when none is open', async () => {
    resetStore({
      materials: [
        material({ filename: 'week1.pdf' }),
        material({ filename: 'week2.pdf' }),
      ],
    })
    await openGrillTab('/courses/cs101')

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Material' })).toHaveValue(
        'm-week1.pdf',
      ),
    )
  })

  it('says so when the course has no Materials', async () => {
    resetStore()
    await openGrillTab('/courses/cs101')

    expect(screen.getByText(/nothing to be grilled on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grill me' })).toBeNull()
  })
})

describe('a grill', () => {
  it('shows the first batch while the second is still being written, and waits for both', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    // Long enough that a loaded test runner still sees the form before batch 1 lands.
    holdBatch(1, 1500)
    const user = await openGrillTab()

    await user.click(screen.getByRole('button', { name: 'Grill me' }))

    expect(
      await screen.findByText('What resolves a collision?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Define a hash collision.')).toBeNull()
    expect(screen.getByText(/Writing questions/)).toHaveTextContent(
      'Writing questions for pages 13–24…',
    )
    expect(screen.getByText('week1.pdf · 24 pages')).toBeInTheDocument()
    // The key never reaches the form.
    expect(document.body).not.toHaveTextContent(
      'Chaining keeps colliding keys in one bucket.',
    )
    const submit = screen.getByRole('button', { name: 'Submit answers' })
    await user.click(screen.getByRole('radio', { name: 'Chaining' }))
    expect(screen.getByText('Answered 1 of 1')).toBeInTheDocument()
    expect(submit).toBeDisabled()

    expect(
      await screen.findByText(
        'Define a hash collision.',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText(/Writing questions/)).toBeNull(),
    )
    expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument()
    expect(submit).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', { name: 'Answer 2' }),
      'two keys, one bucket',
    )
    expect(submit).toBeEnabled()
  })

  it('grades every answer at once and links each question to its Page', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    const user = await openGrillTab()
    await startGrill(user)

    await user.click(screen.getByRole('radio', { name: 'Sorting' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Answer 2' }),
      'two keys, one bucket',
    )
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

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

  it('offers a retry for a batch that could not be written', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    failBatch(1)
    const user = await openGrillTab()

    await user.click(screen.getByRole('button', { name: 'Grill me' }))

    expect(
      await screen.findByText(/pages 13–24 could not be written/),
    ).toBeInTheDocument()
    await screen.findByText('What resolves a collision?')
    await user.click(screen.getByRole('radio', { name: 'Chaining' }))
    expect(screen.getByRole('button', { name: 'Submit answers' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByText('Define a hash collision.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/could not be written/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Submit answers' }),
    ).toBeDisabled()
  })

  it('shows an ungraded short answer as such', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    const only = grillQuestion({
      id: 'q1',
      kind: 'short_answer',
      prompt: 'Why chain?',
      options: null,
      page: null,
    })
    grillNextWith(grill({ questions: [only] }))
    gradeNextGrillWith({
      grill: grill({
        status: 'submitted',
        score: 0,
        questions: [
          {
            ...only,
            given: { text: 'hmm', correct: null, reason: 'Not graded.' },
          },
        ],
      }),
      remark: '',
    })
    const user = await openGrillTab()
    await user.click(screen.getByRole('button', { name: 'Grill me' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Answer 1' }),
      'hmm',
    )
    await waitFor(() =>
      expect(screen.queryByText(/Writing questions/)).toBeNull(),
    )
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(await screen.findByText('0 / 1 correct')).toBeInTheDocument()
    expect(screen.getByText('Not graded')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /p\. / })).toBeNull()
  })

  it('keeps the form when grading fails, and abandons it on cancel', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    server.use(
      http.post('*/quizzes.grade', () =>
        HttpResponse.json(
          { detail: 'Answers could not be graded; please retry' },
          { status: 502 },
        ),
      ),
    )
    const user = await openGrillTab()
    await startGrill(user)
    await user.click(screen.getByRole('radio', { name: 'Chaining' }))
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

  it('reports a failed plan and lets the student try again', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    server.use(
      http.post('*/quizzes.generate', () =>
        HttpResponse.json(
          { detail: 'material bytes are unavailable' },
          { status: 404 },
        ),
      ),
    )
    const user = await openGrillTab()
    await user.click(screen.getByRole('button', { name: 'Grill me' }))

    expect(await screen.findByText(/bytes are unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grill me' })).toBeEnabled()
  })

  it('survives a switch to Ask and back', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    const user = await openGrillTab()
    await startGrill(user)
    await user.click(screen.getByRole('radio', { name: 'Chaining' }))

    await user.click(screen.getByRole('tab', { name: /Ask/ }))
    expect(screen.queryByRole('radio', { name: 'Chaining' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: /Grill/ }))
    expect(screen.getByRole('radio', { name: 'Chaining' })).toBeChecked()
    expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument()
  })
})
