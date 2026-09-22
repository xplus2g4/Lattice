import { screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'
import { RemoveCourseButton } from './remove-course-button'
import { server } from '#/test/server'
import { renderRoute, renderWithQuery } from '#/test/render'

it('disables only the removing course and lets another workspace open', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  server.use(
    http.post('*/courses.delete', async () => {
      await pending
      return HttpResponse.json({ deleted: true })
    }),
  )
  localStorage.setItem(
    'lattice.library',
    JSON.stringify({ courses: ['cs2100', 'cs3216'], lastOpened: null }),
  )
  const user = userEvent.setup()
  const { router } = renderRoute('/')
  try {
    const target = within(
      await screen.findByRole('group', { name: 'CS2100 course' }),
    )
    await user.click(target.getByRole('button', { name: 'Remove course' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove course permanently' }),
    )
    expect(await target.findByRole('status')).toHaveTextContent('Removing…')
    expect(
      target.getByRole('button', { name: 'Open workspace' }),
    ).toBeDisabled()
    const other = within(screen.getByRole('group', { name: 'CS3216 course' }))
    await user.click(other.getByRole('link', { name: 'Open workspace' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/courses/cs3216'),
    )
    finish()
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('lattice.library')!).courses,
      ).toEqual(['cs3216']),
    )
  } finally {
    finish()
  }
})

it('closes confirmation immediately and keeps removal running across navigation', async () => {
  let finish!: () => void
  let requests = 0
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  server.use(
    http.post('*/courses.delete', async () => {
      requests++
      await pending
      return HttpResponse.json({ deleted: true })
    }),
  )
  localStorage.setItem(
    'lattice.library',
    JSON.stringify({ courses: ['cs2100'], lastOpened: null }),
  )
  function App() {
    const [home, setHome] = useState(true)
    return (
      <>
        <button onClick={() => setHome(!home)}>
          {home ? 'Study another course' : 'Back home'}
        </button>
        {home && (
          <RemoveCourseButton course="cs2100" user="alice@example.com" />
        )}
      </>
    )
  }
  const user = userEvent.setup()
  renderWithQuery(<App />)
  try {
    await user.click(screen.getByRole('button', { name: 'Remove course' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove course permanently' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Removing…')
    await user.click(
      screen.getByRole('button', { name: 'Study another course' }),
    )
    await user.click(screen.getByRole('button', { name: 'Back home' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Removing…')
    expect(
      screen.queryByRole('button', { name: 'Remove course' }),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Study another course' }),
    )
    finish()
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('lattice.library')!).courses,
      ).toEqual([]),
    )
    expect(requests).toBe(1)
  } finally {
    finish()
  }
})

it('warns, allows cancellation, then removes the course and its browser bookmarks after confirmation', async () => {
  let deletes = 0
  server.use(
    http.post('*/courses.delete', () => {
      deletes++
      return HttpResponse.json({ deleted: true })
    }),
  )
  localStorage.setItem(
    'lattice.library',
    JSON.stringify({
      courses: ['cs2100', 'cs3216'],
      lastOpened: { course: 'cs2100', filename: 'week1.pdf' },
    }),
  )
  localStorage.setItem(
    'lattice.session.api.cs2100.alice@example.com',
    'old-session',
  )
  const user = userEvent.setup()
  renderWithQuery(
    <RemoveCourseButton course="cs2100" user="alice@example.com" />,
  )
  await user.click(screen.getByRole('button', { name: 'Remove course' }))
  expect(
    screen.getByText('All your notes and materials will be gone!'),
  ).toBeInTheDocument()
  expect(deletes).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(deletes).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Remove course' }))
  await user.click(
    screen.getByRole('button', { name: 'Remove course permanently' }),
  )
  await screen.findByRole('button', { name: 'Remove course' })
  expect(deletes).toBe(1)
  expect(JSON.parse(localStorage.getItem('lattice.library')!)).toEqual({
    courses: ['cs3216'],
    lastOpened: null,
  })
  expect(
    localStorage.getItem('lattice.session.api.cs2100.alice@example.com'),
  ).toBeNull()
})

it('keeps the course and shows the API error when removal fails', async () => {
  server.use(
    http.post('*/courses.delete', () =>
      HttpResponse.json({ detail: 'Please retry removal' }, { status: 502 }),
    ),
  )
  localStorage.setItem(
    'lattice.library',
    JSON.stringify({ courses: ['cs2100'], lastOpened: null }),
  )
  const user = userEvent.setup()
  renderWithQuery(
    <RemoveCourseButton course="cs2100" user="alice@example.com" />,
  )
  await user.click(screen.getByRole('button', { name: 'Remove course' }))
  await user.click(
    screen.getByRole('button', { name: 'Remove course permanently' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Please retry removal',
  )
  expect(JSON.parse(localStorage.getItem('lattice.library')!).courses).toEqual([
    'cs2100',
  ])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  server.use(
    http.post('*/courses.delete', () => HttpResponse.json({ deleted: true })),
  )
  await user.click(screen.getByRole('button', { name: 'Retry removal' }))
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem('lattice.library')!).courses,
    ).toEqual([]),
  )
})
