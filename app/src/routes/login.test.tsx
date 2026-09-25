import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { LoginGrid } from '#/components/lattice/login-grid'
import { renderRoute } from '#/test/render'

function media({ wide = true, reduced = false } = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query.includes('min-width')
      ? wide && (!query.includes('no-preference') || !reduced)
      : query.includes('no-preference')
        ? !reduced
        : query.includes('reduced-motion') && reduced,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }))
}

async function openLogin(path = '/login') {
  const rendered = renderRoute(path)
  await screen.findByRole('heading', {
    name: /Sign in to Lattice|You have been invited/,
  })
  return rendered.container.querySelector('[data-login-grid]')
}

describe('the login background', () => {
  it('renders a deterministic static grid during SSR', () => {
    const markup = renderToString(<LoginGrid />)
    expect(markup).toContain('data-motion="static"')
    expect(markup).not.toContain('Pause background motion')
    expect(renderToString(<LoginGrid />)).toBe(markup)
  })

  it('is decorative and can be paused and resumed without changing sign-in', async () => {
    media()
    const user = userEvent.setup()
    const grid = await openLogin()

    expect(grid).toHaveAttribute('aria-hidden', 'true')
    expect(grid).toHaveAttribute('focusable', 'false')
    expect(grid).toHaveAttribute('data-motion', 'running')
    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute('href', '/auth/google')

    await user.click(
      screen.getByRole('button', { name: 'Pause background motion' }),
    )
    expect(grid).toHaveAttribute('data-motion', 'paused')
    await user.type(
      screen.getByRole('textbox', { name: 'Enter your invite code' }),
      'example-invite',
    )
    expect(grid).toHaveAttribute('data-motion', 'paused')
    await user.click(
      screen.getByRole('button', { name: 'Resume background motion' }),
    )
    expect(grid).toHaveAttribute('data-motion', 'running')
    expect(
      screen.getByRole('textbox', { name: 'Enter your invite code' }),
    ).toBeEnabled()
  })

  it('keeps a static grid when reduced motion is requested', async () => {
    media({ reduced: true })
    const grid = await openLogin()

    expect(grid).toHaveAttribute('data-motion', 'static')
    expect(
      screen.queryByRole('button', { name: /background motion/ }),
    ).not.toBeInTheDocument()
  })

  it('does not animate the desktop-only background on a narrow viewport', async () => {
    media({ wide: false })
    const grid = await openLogin()

    expect(grid).toHaveAttribute('data-motion', 'static')
    expect(
      screen.queryByRole('button', { name: /background motion/ }),
    ).not.toBeInTheDocument()
  })

  it('stops in a hidden tab and resumes when visible', async () => {
    media()
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible')
    const grid = await openLogin()
    expect(grid).toHaveAttribute('data-motion', 'running')

    act(() => {
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(grid).toHaveAttribute('data-motion', 'static'))

    act(() => {
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(grid).toHaveAttribute('data-motion', 'running'))
  })

  it('preserves the Invite on the Google sign-in action', async () => {
    media({ reduced: true })
    await openLogin('/login?invite=example-invite')

    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute('href', '/auth/google?invite=example-invite')
    expect(
      screen.queryByRole('textbox', { name: 'Enter your invite code' }),
    ).not.toBeInTheDocument()
  })
})
