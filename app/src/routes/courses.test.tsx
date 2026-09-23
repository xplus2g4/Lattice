import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { material } from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { renderRoute } from '#/test/render'

describe('a course URL', () => {
  it('shows the materials section on its own route', async () => {
    resetStore({ materials: [material({ filename: 'week1.pdf' })] })

    renderRoute('/courses/cs101/materials')

    expect(await screen.findByText('week1.pdf')).toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText(/Ask a question/),
    ).not.toBeInTheDocument()
  })

  it('opens on the reader workspace with Ask', async () => {
    renderRoute('/courses/cs101')

    expect(
      await screen.findByPlaceholderText(/Ask about CS101/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
  })

  it('names the course it is scoped to', async () => {
    renderRoute('/courses/cs101/materials')

    expect(await screen.findByText('cs101')).toBeInTheDocument()
  })

  it('refuses a course code the API would reject', async () => {
    renderRoute('/courses/NOT_A_COURSE/materials')

    expect(await screen.findByText(/not a course code/i)).toBeInTheDocument()
  })
})
