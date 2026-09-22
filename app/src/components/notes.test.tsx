import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { NotesPanel as Notes } from '#/components/lattice/notes-panel'
import { note } from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { renderWithQuery } from '#/test/render'

const USER = 'alice@example.com'

function show() {
  return renderWithQuery(<Notes course="cs101" user={USER} />)
}

describe('the notes list', () => {
  it('says so when the student has written nothing yet', async () => {
    show()

    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument()
  })

  it('shows a saved note with its Cognify status', async () => {
    resetStore({
      notes: [
        note({
          id: 'week3',
          body_md: 'hash tables are week 3',
          status: 'cognifying',
        }),
      ],
    })

    show()

    expect(await screen.findByText('week3')).toBeInTheDocument()
    expect(screen.getByText('hash tables are week 3')).toBeInTheDocument()
    expect(screen.getByText('cognifying')).toBeInTheDocument()
  })

  it('shows only the calling student\u2019s notes', async () => {
    resetStore({
      notes: [
        note({ owner: USER, id: 'mine' }),
        note({ owner: 'bob@example.com', id: 'bobs' }),
      ],
    })

    show()

    expect(await screen.findByText('mine')).toBeInTheDocument()
    expect(screen.queryByText('bobs')).not.toBeInTheDocument()
  })

  it('explains why a note failed to Cognify', async () => {
    resetStore({
      notes: [note({ status: 'failed', error: 'cost ceiling exceeded' })],
    })

    show()

    expect(await screen.findByText('cost ceiling exceeded')).toBeInTheDocument()
  })
})

describe('writing a note', () => {
  it('adds it to the list, queued for Cognify', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByText(/No notes yet/)
    await user.click(screen.getByRole('button', { name: 'New note' }))

    await user.type(
      screen.getByPlaceholderText('Markdown body'),
      'hash tables are week 3',
    )
    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(
      await within(screen.getByRole('list')).findByText(
        'hash tables are week 3',
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText('queued')).toBeInTheDocument()
  })

  it('refuses to save an empty note', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByText(/No notes yet/)
    await user.click(screen.getByRole('button', { name: 'New note' }))

    await user.type(screen.getByPlaceholderText('Markdown body'), '   ')

    expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled()
  })
})
