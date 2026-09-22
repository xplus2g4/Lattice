import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it } from 'vitest'
import { renderRoute } from '#/test/render'
import { resetStore } from '#/test/handlers'
import { material, note } from '#/test/fixtures'
import { server } from '#/test/server'

function navigation() {
  const nav = within(
    screen.getByRole('navigation', { name: 'Main navigation' }),
  )
  expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
    'Homepage',
    'Materials',
    'Notes',
    'Ask',
    'Practice',
  ])
  return nav
}

it('shows all five tabs on an empty homepage and directs course selection there', async () => {
  const user = userEvent.setup()
  const { router } = renderRoute('/')
  await screen.findByRole('heading', { name: 'Your courses' })
  const nav = navigation()
  expect(screen.getByRole('combobox', { name: 'Active course' })).toBeDisabled()
  await user.click(nav.getByRole('link', { name: 'Materials' }))
  await waitFor(() => expect(router.state.location.hash).toBe('courses'))
  expect(
    screen.getByRole('heading', { name: 'Your courses' }),
  ).toBeInTheDocument()
})

it('keeps the sidebar while opening the working panels and returns Homepage to all courses', async () => {
  localStorage.setItem(
    'lattice.library',
    JSON.stringify({ courses: ['cs101'], lastOpened: null }),
  )
  resetStore({
    materials: [material({ filename: 'Lecture.pdf' })],
    notes: [note({ title: 'My revision Note' })],
  })
  server.use(http.get('*/quizzes.list', () => HttpResponse.json([])))
  const user = userEvent.setup()
  const { router } = renderRoute('/')
  await screen.findByRole('heading', { name: 'Your courses' })
  await user.click(navigation().getByRole('link', { name: 'Materials' }))
  expect(await screen.findByText('Lecture.pdf')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
  await user.click(navigation().getByRole('link', { name: 'Notes' }))
  await user.click(
    await screen.findByRole('button', { name: /My revision Note/ }),
  )
  expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'My revision Note',
  )
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(navigation().getByRole('link', { name: 'Ask' }))
  expect(
    await screen.findByPlaceholderText(/Ask about CS101/),
  ).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
  await user.click(navigation().getByRole('link', { name: 'Practice' }))
  expect(
    await screen.findByRole('heading', { name: 'Grill this material' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Grill me' }),
  ).not.toBeInTheDocument()
  await user.click(navigation().getByRole('link', { name: 'Homepage' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(
    await screen.findByRole('heading', { name: 'Your courses' }),
  ).toBeInTheDocument()
  navigation()
}, 15000)

it('switches courses within the current tab and remembers the selection on Homepage', async () => {
  localStorage.setItem(
    'lattice.library',
    JSON.stringify({ courses: ['cs101', 'cs202'], lastOpened: null }),
  )
  resetStore({
    notes: [
      note({ course: 'cs101', title: 'First course Note' }),
      note({ course: 'cs202', title: 'Second course Note' }),
    ],
  })
  const user = userEvent.setup()
  const { router } = renderRoute('/courses/cs101/notes')
  await screen.findByText('First course Note')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Active course' }),
    'cs202',
  )
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/courses/cs202/notes'),
  )
  expect(await screen.findByText('Second course Note')).toBeInTheDocument()
  expect(screen.queryByText('First course Note')).not.toBeInTheDocument()
  await user.click(navigation().getByRole('link', { name: 'Homepage' }))
  await screen.findByRole('heading', { name: 'Your courses' })
  expect(screen.getByRole('combobox', { name: 'Active course' })).toHaveValue(
    'cs202',
  )
  expect(navigation().getByRole('link', { name: 'Practice' })).toHaveAttribute(
    'href',
    '/courses/cs202/quizzes',
  )
})
