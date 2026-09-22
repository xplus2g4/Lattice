import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { NotesPanel } from './notes-panel'
import { note } from '#/test/fixtures'
import { resetStore, store } from '#/test/handlers'
import { renderWithQuery } from '#/test/render'

it('renames an existing Note and keeps the title after reopening', async () => {
  const user = userEvent.setup()
  resetStore({ notes: [note({ id: '22222222-2222-4222-8222-222222222222' })] })
  const view = renderWithQuery(
    <NotesPanel course="cs101" user="alice@example.com" />,
  )
  await user.click(
    await screen.findByRole('button', { name: /hash tables are week 3/ }),
  )
  const title = screen.getByRole('textbox', { name: 'Note title' })
  await user.clear(title)
  await user.type(title, 'Week 3 recap')
  // A simultaneous Page autosave must not be overwritten by a title-only edit.
  store.notes[0].body_md = 'Newer Page autosave'
  await user.click(screen.getByRole('button', { name: 'Save note' }))
  expect(
    await within(screen.getByRole('list')).findByText('Week 3 recap'),
  ).toBeInTheDocument()
  view.unmount()
  renderWithQuery(<NotesPanel course="cs101" user="alice@example.com" />)
  await user.click(await screen.findByRole('button', { name: /Week 3 recap/ }))
  expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Week 3 recap',
  )
  expect(screen.getByPlaceholderText('Markdown body')).toHaveValue(
    'Newer Page autosave',
  )
})
