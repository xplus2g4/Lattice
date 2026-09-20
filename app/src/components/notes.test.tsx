import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Notes } from '#/components/notes'
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

    expect(await screen.findByText('No notes yet.')).toBeInTheDocument()
  })

  it('shows a saved note with its indexing status', async () => {
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

  it('explains why a note failed to index', async () => {
    resetStore({
      notes: [note({ status: 'failed', error: 'cost ceiling exceeded' })],
    })

    show()

    expect(await screen.findByText('cost ceiling exceeded')).toBeInTheDocument()
  })
})

describe('writing a note', () => {
  it('loads an existing Note into the editor and saves it under the same ID', async () => {
    const user = userEvent.setup()
    resetStore({ notes: [note({ id: 'week3', body_md: 'original idea' })] })
    show()
    await user.click(await screen.findByRole('button', { name: /week3/ }))
    expect(screen.getByPlaceholderText('note id')).toHaveValue('week3')
    expect(screen.getByPlaceholderText('note id')).toHaveAttribute('readonly')
    await user.clear(screen.getByLabelText('Note content'))
    await user.type(screen.getByLabelText('Note content'), 'a clearer idea')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await within(screen.getByRole('button', { name: /week3/ })).findByText(
        'a clearer idea',
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText('queued')).toBeInTheDocument()
  })

  it('prevents accidentally overwriting an existing Note from a new draft', async () => {
    const user = userEvent.setup()
    resetStore({ notes: [note({ id: 'week3' })] })
    show()
    await screen.findByText('week3')
    await user.type(screen.getByPlaceholderText('note id'), 'week3')
    await user.type(screen.getByLabelText('Note content'), 'another thought')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/That Note ID already exists/)).toBeInTheDocument()
  })

  it('adds it to the list, queued for indexing', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByText('No notes yet.')

    await user.clear(screen.getByPlaceholderText('note id'))
    await user.type(screen.getByPlaceholderText('note id'), 'week3')
    await user.type(
      screen.getByPlaceholderText('Markdown body'),
      'hash tables are week 3',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('week3')).toBeInTheDocument()
    expect(await screen.findByText('queued')).toBeInTheDocument()
  })

  it('refuses to save an empty note', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByText('No notes yet.')

    await user.type(screen.getByPlaceholderText('Markdown body'), '   ')

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
