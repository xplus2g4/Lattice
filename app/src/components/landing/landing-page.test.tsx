import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderRoute } from '#/test/render'

describe('landing page', () => {
  it('sends every Sign up and Sign in action to the real login', async () => {
    renderRoute('/landing')
    await screen.findByRole('heading', { level: 1, name: /Stay curious/ })

    const actions = [
      ...screen.getAllByRole('link', { name: 'Sign up' }),
      ...screen.getAllByRole('link', { name: 'Sign in' }),
    ]
    expect(actions.length).toBeGreaterThan(1)
    for (const link of actions) expect(link).toHaveAttribute('href', '/login')
  })

  it('opens the invite form when a visitor signs up', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/landing')
    await user.click(
      (await screen.findAllByRole('link', { name: 'Sign up' }))[0],
    )

    expect(
      await screen.findByRole('textbox', { name: 'Enter your invite code' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('is reachable from the login page', async () => {
    renderRoute('/login')
    expect(
      await screen.findByRole('link', { name: 'What is Lattice?' }),
    ).toHaveAttribute('href', '/landing')
  })
})
