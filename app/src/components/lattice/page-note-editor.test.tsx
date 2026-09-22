import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { PageNoteEditor } from './page-note-editor'
import { renderWithQuery } from '#/test/render'
import {
  installReaderHandlers,
  readerNote,
  READER_MATERIAL,
} from '#/test/reader-handlers'
import { server } from '#/test/server'

const USER = 'alice@example.com'
function Editor() {
  const [page, setPage] = useState(1)
  const [user, setUser] = useState(USER)
  return (
    <>
      <button onClick={() => setPage(page === 1 ? 2 : 1)}>Change page</button>
      <button onClick={() => setUser('bob@example.com')}>Change user</button>
      <PageNoteEditor
        user={user}
        course="cs101"
        material={READER_MATERIAL}
        page={page}
      />
    </>
  )
}

describe('Page Notes in the reader', () => {
  it('saves to the old Page when navigating and keeps each student’s Notes separate', async () => {
    const records = installReaderHandlers()
    const user = userEvent.setup()
    renderWithQuery(<Editor />)
    const input = await screen.findByRole('textbox')
    await user.type(input, 'My first page')
    await user.click(screen.getByRole('button', { name: 'Change page' }))
    expect(await screen.findByRole('textbox')).toHaveValue('')
    await waitFor(() =>
      expect(records.writes).toContainEqual(
        expect.objectContaining({
          user: USER,
          material: READER_MATERIAL,
          page: 1,
          body_md: 'My first page',
          expected_revision: 0,
        }),
      ),
    )
    await user.type(screen.getByRole('textbox'), 'Second page')
    fireEvent.blur(screen.getByRole('textbox'))
    await screen.findByText('Ready for Ask')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change page' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveValue('My first page'),
    )
    await user.click(screen.getByRole('button', { name: 'Change user' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
  })

  it('saves an empty Note instead of resurrecting cleared text', async () => {
    const records = installReaderHandlers()
    records.notes.set(
      records.key(USER, READER_MATERIAL, 1),
      readerNote('Old Note'),
    )
    const user = userEvent.setup()
    renderWithQuery(<Editor />)
    await user.clear(await screen.findByRole('textbox'))
    fireEvent.blur(screen.getByRole('textbox'))
    await waitFor(() =>
      expect(
        records.notes.get(records.key(USER, READER_MATERIAL, 1))?.body_md,
      ).toBe(''),
    )
  })

  it('preserves the draft on a save failure and retries explicitly', async () => {
    installReaderHandlers()
    server.use(
      http.post(
        '*/notes.save',
        () =>
          HttpResponse.json(
            { detail: 'temporarily unavailable' },
            { status: 503 },
          ),
        { once: true },
      ),
    )
    const user = userEvent.setup()
    renderWithQuery(<Editor />)
    await user.type(await screen.findByRole('textbox'), 'Keep this text')
    fireEvent.blur(screen.getByRole('textbox'))
    await screen.findByText('Could not save. Your draft has been kept.')
    expect(screen.getByRole('textbox')).toHaveValue('Keep this text')
    await user.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('Ready for Ask')
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('does not overwrite another edit without an explicit conflict choice', async () => {
    const records = installReaderHandlers()
    const id = records.key(USER, READER_MATERIAL, 1)
    records.notes.set(id, readerNote('Original'))
    const user = userEvent.setup()
    renderWithQuery(<Editor />)
    const input = await screen.findByRole('textbox')
    records.notes.set(id, readerNote('Changed in another tab', 1, 2))
    await user.clear(input)
    await user.type(input, 'My draft')
    fireEvent.blur(input)
    await screen.findByText(
      'This Note changed elsewhere. Your draft has been kept.',
    )
    expect(records.notes.get(id)?.body_md).toBe('Changed in another tab')
    await user.click(
      screen.getByRole('button', { name: 'Replace with my draft' }),
    )
    await screen.findByText('Ready for Ask')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(records.notes.get(id)?.body_md).toBe('My draft')
    expect(records.writes.at(-1)?.expected_revision).toBe(2)
  })
})
