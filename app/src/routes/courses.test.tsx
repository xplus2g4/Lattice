import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  assistantTurn,
  material,
  note,
  session,
  tierResult,
} from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'

const USER = 'alice@example.com'

// The default identity the page starts with; every section sends it as `X-User`.
function asDefaultUser<T>(make: (owner: string) => T) {
  return make(USER)
}

describe('a course URL', () => {
  it('shows the materials section on its own route', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })

    renderRoute('/courses/cs101/materials')

    expect(await screen.findByText('week1.pdf')).toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText(/Ask a question/),
    ).not.toBeInTheDocument()
  })

  it('shows the notes section on its own route', async () => {
    resetStore({
      notes: [asDefaultUser((owner) => note({ owner, id: 'week3' }))],
    })

    renderRoute('/courses/cs101/notes')

    expect(await screen.findByText('week3')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Upload' }),
    ).not.toBeInTheDocument()
  })

  it('opens on the ask section', async () => {
    renderRoute('/courses/cs101')

    expect(
      await screen.findByPlaceholderText(/Ask a question/),
    ).toBeInTheDocument()
  })

  it('names the course it is scoped to', async () => {
    renderRoute('/courses/cs101/materials')

    expect(await screen.findByText('cs101')).toBeInTheDocument()
  })

  it('refuses a course code the API would reject', async () => {
    renderRoute('/courses/NOT_A_COURSE/materials')

    expect(await screen.findByText(/not a course code/i)).toBeInTheDocument()
  })

  it('keeps the chosen section while moving between them', async () => {
    const user = userEvent.setup()
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })
    renderRoute('/courses/cs101/materials')
    await screen.findByText('week1.pdf')

    await user.click(screen.getByRole('link', { name: 'Notes' }))

    expect(await screen.findByText('No notes yet.')).toBeInTheDocument()
    expect(screen.queryByText('week1.pdf')).not.toBeInTheDocument()
  })
})

describe('the learning workspace', () => {
  it('shows only the current course Materials and the current user’s Notes on the dashboard', async () => {
    resetStore({
      materials: [
        material({ filename: 'week1.pdf' }),
        material({ course: 'cs202', filename: 'other.pdf' }),
      ],
      notes: [
        note({ id: 'my-note' }),
        note({ owner: 'bob@example.com', id: 'bobs-note' }),
      ],
    })
    renderRoute('/courses/cs101/dashboard')
    expect(await screen.findByText('week1.pdf')).toBeInTheDocument()
    expect(await screen.findByText('my-note')).toBeInTheDocument()
    expect(screen.queryByText('other.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('bobs-note')).not.toBeInTheDocument()
  })

  it('filters dashboard Materials without pretending to search across courses', async () => {
    const user = userEvent.setup()
    resetStore({
      materials: [
        material({ filename: 'week1.pdf' }),
        material({ filename: 'tutorial.md' }),
      ],
    })
    renderRoute('/courses/cs101/dashboard')
    await screen.findByText('tutorial.md')
    await user.type(
      screen.getByRole('textbox', { name: 'Search Materials' }),
      'week',
    )
    expect(screen.getByText('week1.pdf')).toBeInTheDocument()
    expect(screen.queryByText('tutorial.md')).not.toBeInTheDocument()
  })

  it('labels mastery tracking as planned instead of inventing scores', async () => {
    renderRoute('/courses/cs101/mastery')
    expect(
      await screen.findByText('PLANNED · NOT YET AVAILABLE'),
    ).toBeInTheDocument()
    expect(screen.getByText(/No scores are recorded/)).toBeInTheDocument()
  })

  it('opens a course from the landing page on its dashboard', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/')
    await user.type(await screen.findByLabelText('Course code'), 'CS101')
    await user.click(screen.getByRole('button', { name: 'Open course' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/courses/cs101/dashboard'),
    )
    expect(
      await screen.findByRole('heading', { name: 'My learning dashboard' }),
    ).toBeInTheDocument()
  })

  it('clears the private Note editor when the development identity changes', async () => {
    const user = userEvent.setup()
    resetStore({
      notes: [note({ id: 'alice-note', body_md: 'Alice private writing' })],
    })
    renderRoute('/courses/cs101/notes')
    await user.click(await screen.findByRole('button', { name: /alice-note/ }))
    expect(screen.getByLabelText('Note content')).toHaveValue(
      'Alice private writing',
    )
    await user.click(screen.getByText('Local workspace'))
    await user.clear(screen.getByLabelText('User'))
    await user.type(screen.getByLabelText('User'), 'bob@example.com')
    expect(screen.getByLabelText('Note content')).toHaveValue('')
    expect(screen.queryByText('Alice private writing')).not.toBeInTheDocument()
  })
})

describe('a conversation', () => {
  it('can be opened directly by its URL', async () => {
    resetStore({
      sessions: {
        'sess-earlier': session({
          id: 'sess-earlier',
          owner: USER,
          turns: [
            assistantTurn({
              results: [tierResult({ answer: 'Earlier answer.' })],
            }),
          ],
        }),
      },
    })

    renderRoute('/courses/cs101/ask/sess-earlier')

    expect(await screen.findByText('Earlier answer.')).toBeInTheDocument()
  })

  it('gets its own URL as soon as it starts', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/courses/cs101/ask')
    await screen.findByPlaceholderText(/Ask a question/)

    await user.type(
      screen.getByPlaceholderText(/Ask a question/),
      'what is a hash table?',
    )
    await user.click(screen.getByRole('button', { name: 'Ask' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/courses/cs101/ask/sess-1'),
    )
  })

  it('falls back to a new conversation when the API has forgotten it', async () => {
    const { router } = renderRoute('/courses/cs101/ask/sess-gone')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/courses/cs101/ask'),
    )
    expect(screen.queryByText('no such session')).not.toBeInTheDocument()
  })
})
