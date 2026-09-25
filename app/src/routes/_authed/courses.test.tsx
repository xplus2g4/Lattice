import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { material } from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'

describe('a course URL', () => {
  it('opens the workspace with its materials, notes and Ask', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })

    renderRoute('/courses/cs101')

    expect(await screen.findByText('week1.pdf')).toBeInTheDocument()
    expect(screen.getByText('NOTES')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Ask about CS101/)).toBeInTheDocument()
  })

  it('names the course it is scoped to', async () => {
    renderRoute('/courses/cs101')

    expect(await screen.findByText('cs101')).toBeInTheDocument()
  })

  it('keeps a Page range only for an open PDF Material', async () => {
    const { router } = renderRoute(
      '/courses/cs101?material=week1.pdf&page=3&pageEnd=2',
    )
    await screen.findByText('cs101')
    expect(router.state.matches.at(-1)?.search).toEqual({
      material: 'week1.pdf',
      page: 3,
    })

    await router.navigate({
      to: '/courses/$course',
      params: { course: 'cs101' },
      search: { page: 3 },
    })
    expect(router.state.matches.at(-1)?.search).toEqual({})
  })

  it('refuses a course code the API would reject', async () => {
    renderRoute('/courses/NOT_A_COURSE')

    expect(await screen.findByText(/not a course code/i)).toBeInTheDocument()
  })
})
