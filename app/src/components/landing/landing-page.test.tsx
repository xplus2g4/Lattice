import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSessionUser } from '#/lib/auth'
import { renderRoute } from '#/test/render'

describe('landing page', () => {
  describe('signed out', () => {
    beforeEach(() => vi.mocked(getSessionUser).mockResolvedValue(null))
    afterEach(() => vi.mocked(getSessionUser).mockReset())

    it('is what / shows, with every Sign up and Sign in going to the real login', async () => {
      renderRoute('/')
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
      const { router } = renderRoute('/')
      await user.click(
        (await screen.findAllByRole('link', { name: 'Sign up' }))[0],
      )

      expect(
        await screen.findByRole('textbox', { name: 'Enter your invite code' }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/login')
    })

    it('still sends any other signed-in page to the login', async () => {
      const { router } = renderRoute('/manage')
      await screen.findByRole('heading', { name: 'Sign in to Lattice' })
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('is reachable from the login page', async () => {
    renderRoute('/login')
    expect(
      await screen.findByRole('link', { name: 'What is Lattice?' }),
    ).toHaveAttribute('href', '/')
  })
})
