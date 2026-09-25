import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderRoute } from '#/test/render'
import { server } from '#/test/server'

import type { CourseOut, MeOut } from '#/lib/generated'

const course: CourseOut = {
  id: 'course-1',
  code: 'cs101',
  name: 'Computer Science',
  term: null,
  owner_user_id: 'alice',
  global_dataset_name: 'cs101-global',
  created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  server.use(
    http.get('*/courses.list', () =>
      HttpResponse.json<Array<CourseOut>>([course]),
    ),
    http.get('*/me.get', () =>
      HttpResponse.json<MeOut>({
        courses: [course],
        user: {
          id: 'alice',
          email: 'alice@example.com',
          name: 'Alice',
          role: 'student',
          notes_opt_out: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      }),
    ),
  )
})

describe('home course cards', () => {
  it('greets the user without promotional copy or an empty reading section', async () => {
    renderRoute('/')

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: /Alice/,
    })
    expect(heading).toHaveClass('text-2xl')
    expect(screen.queryByText(/Make room for/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Your Materials\. Your Notes\./),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Continue reading' }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: /Your courses/ }),
    ).toBeInTheDocument()
  })

  it('shows Continue reading before the courses when a Material was opened', async () => {
    localStorage.setItem(
      'lattice.library:alice@example.com',
      JSON.stringify({
        courses: ['cs101'],
        lastOpened: { course: 'cs101', filename: 'week1.pdf' },
        openedAt: {},
      }),
    )
    renderRoute('/')

    const heading = await screen.findByRole('heading', {
      name: 'Continue reading',
    })
    const link = screen.getByRole('link', { name: 'Resume reading Week1' })
    expect(link).toHaveAttribute('href', '/courses/cs101?material=week1.pdf')
    const courses = screen.getByRole('heading', { name: /Your courses/ })
    expect(
      heading.compareDocumentPosition(courses) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps the guided setup for an account without courses', async () => {
    server.use(
      http.get('*/courses.list', () => HttpResponse.json<Array<CourseOut>>([])),
    )
    renderRoute('/')

    expect(await screen.findByText('Welcome to Lattice')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Create a course' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Course code')).toBeInTheDocument()
  })

  it('places course cards and the add-course tile in a responsive grid', async () => {
    renderRoute('/')

    const link = await screen.findByRole('link', {
      name: 'Open Computer Science workspace',
    })
    const card = link.parentElement!
    const grid = card.parentElement!.parentElement!
    const addTile = screen
      .getByRole('button', { name: 'Create' })
      .closest('form')!

    expect(grid).toHaveClass('grid', 'sm:grid-cols-2', 'lg:grid-cols-3')
    expect(card).toHaveClass('rounded-[18px]', 'h-full', 'min-h-[236px]')
    expect(addTile.parentElement).toBe(grid)
    expect(addTile).toHaveClass('rounded-[18px]', 'border-dashed')
    expect(link).toHaveAttribute('href', '/courses/cs101')
    expect(screen.getByText('0 materials · 0 notes')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('keeps the name editor independent of workspace navigation', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await user.click(
      await screen.findByRole('button', { name: 'Rename Computer Science' }),
    )
    const input = screen.getByRole('textbox', { name: 'Name for CS101' })
    expect(input).toHaveValue('Computer Science')
    expect(router.state.location.pathname).toBe('/')
    await user.keyboard('{Escape}')
    expect(
      screen.getByRole('button', { name: 'Rename Computer Science' }),
    ).toBeInTheDocument()
  })

  it('creates a course from the add-course tile and opens its workspace', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await screen.findByRole('link', { name: 'Open Computer Science workspace' })
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await user.type(
      screen.getByLabelText('Enter the course code. Bring your Materials.'),
      'CS2040',
    )
    await user.click(create)

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/courses/cs2040'),
    )
  })
})
