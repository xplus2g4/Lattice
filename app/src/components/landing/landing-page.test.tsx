import { readFileSync } from 'node:fs'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { landingHead } from './landing-page'
import { getSessionUser } from '#/lib/auth'
import { renderRoute } from '#/test/render'

describe('landing page', () => {
  describe('signed out', () => {
    beforeEach(() => vi.mocked(getSessionUser).mockResolvedValue(null))
    afterEach(() => vi.mocked(getSessionUser).mockReset())

    it('redirects a signed-out visitor from / to the landing page', async () => {
      const { router } = renderRoute('/')
      await screen.findByRole('heading', {
        level: 1,
        name: /Understand your course. Not just the answer./,
      })
      expect(router.state.location.pathname).toBe('/landing')
    })

    it('sends beta signups to Telegram and sign-in to the real login', async () => {
      renderRoute('/landing')
      await screen.findByRole('heading', {
        level: 1,
        name: /Understand your course. Not just the answer./,
      })

      const beta = screen.getAllByRole('link', { name: 'Join Private Beta' })
      expect(beta.length).toBeGreaterThan(1)
      for (const link of beta) {
        expect(link).toHaveAttribute(
          'href',
          'https://t.me/lattice_private_beta',
        )
        expect(link).toHaveAttribute('target', '_blank')
      }
      const signIn = screen.getAllByRole('link', { name: 'Sign in' })
      expect(signIn.length).toBeGreaterThan(1)
      for (const link of signIn) expect(link).toHaveAttribute('href', '/login')
      expect(screen.getByText('Private beta · Invite required')).toBeVisible()
      expect(
        screen.queryByRole('link', { name: /Use your Invite|Sign up/ }),
      ).not.toBeInTheDocument()
    })

    it('lets students explore labelled product illustrations with the keyboard', async () => {
      const user = userEvent.setup()
      renderRoute('/landing')
      const ask = await screen.findByRole('tab', { name: 'Ask with Citations' })
      expect(ask).toHaveAttribute('aria-selected', 'true')
      expect(
        screen.getByRole('tablist', { name: 'Explore Lattice features' }),
      ).toHaveAttribute('aria-orientation', 'vertical')
      expect(
        screen.getByRole('tablist', { name: 'Explore Lattice features' }),
      ).toHaveClass('flex-col', 'min-w-0', 'w-full')
      expect(ask).toHaveClass('w-full', 'min-w-0', 'whitespace-normal')
      const panels = screen.getAllByRole('tabpanel', { hidden: true })
      expect(panels).toHaveLength(4)
      for (const panel of panels) {
        expect(panel).not.toHaveAttribute('hidden')
        if (panel.getAttribute('data-state') === 'inactive') {
          expect(panel).toHaveAttribute('aria-hidden', 'true')
          expect(panel).toHaveAttribute('inert')
          expect(panel).toHaveStyle({ visibility: 'hidden' })
        }
      }
      expect(
        screen.getByRole('figure', {
          name: 'Course workspace illustration',
        }),
      ).toBeVisible()

      await user.click(screen.getByRole('tab', { name: 'Private Notes' }))
      expect(
        screen.getByRole('tabpanel', { name: 'Private Notes' }),
      ).toBeVisible()
      await waitFor(() =>
        expect(
          screen.getByRole('figure', { name: 'Private Notes illustration' }),
        ).toBeVisible(),
      )

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('tab', { name: 'Grill me' })).toHaveFocus()
      expect(screen.getByRole('tabpanel', { name: 'Grill me' })).toBeVisible()
      await waitFor(() =>
        expect(
          screen.getByRole('figure', { name: 'Grill me illustration' }),
        ).toBeVisible(),
      )

      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('tab', { name: 'Related courses' })).toHaveFocus()
      await waitFor(() =>
        expect(
          screen.getByRole('figure', { name: 'Related courses illustration' }),
        ).toBeVisible(),
      )
      expect(
        screen.getByRole('tabpanel', { name: 'Related courses' }),
      ).toHaveTextContent('Related course · CS3210')
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    })

    it('separates future direction from current features and explains beta access', async () => {
      const user = userEvent.setup()
      renderRoute('/landing')
      const roadmap = await screen.findByRole('region', {
        name: 'Where we’re headed.',
      })
      expect(within(roadmap).getByText('Planned')).toBeVisible()
      expect(
        within(roadmap).getByRole('heading', {
          name: 'Course-based interactive visuals',
        }),
      ).toBeVisible()
      expect(
        within(roadmap).queryByRole('heading', { name: /Related/ }),
      ).not.toBeInTheDocument()
      expect(
        within(roadmap).getByRole('figure', { name: 'Max flow illustration' }),
      ).toHaveTextContent('CS3230')
      await user.click(screen.getByText('Do I need an Invite?'))
      expect(
        screen.getByText(/Your Invite lets you create an account/),
      ).toBeVisible()
      expect(screen.queryByText(/exact Page/)).not.toBeInTheDocument()
    })

    it('markets Pop quiz as in development, with a static concept preview', async () => {
      renderRoute('/landing')
      const popQuiz = await screen.findByRole('listitem', { name: 'Pop quiz' })
      expect(within(popQuiz).getByText('In development')).toBeVisible()
      expect(
        within(popQuiz).getByText('Small check-ins. A clearer next step.'),
      ).toBeVisible()
      expect(within(popQuiz).getByText(/at learning intervals/)).toBeVisible()
      expect(within(popQuiz).getByText(/suggest what to revise/)).toBeVisible()
      expect(within(popQuiz).getByText(/not yet available/)).toBeVisible()
      const preview = within(popQuiz).getByRole('figure', {
        name: 'Pop quiz illustration',
      })
      expect(within(preview).getByText('Suggested revision')).toBeVisible()
      expect(within(preview).getByText(/Cache misses/)).toBeVisible()
      expect(
        screen.queryByRole('tab', { name: 'Pop quiz' }),
      ).not.toBeInTheDocument()
      for (const illustration of screen.getAllByRole('figure')) {
        expect(
          within(illustration).queryByRole('button'),
        ).not.toBeInTheDocument()
        expect(within(illustration).queryByRole('link')).not.toBeInTheDocument()
      }
      expect(
        screen.queryByText('Screenshot placeholder'),
      ).not.toBeInTheDocument()
    })

    it('still sends any other signed-in page to the login', async () => {
      const { router } = renderRoute('/manage')
      await screen.findByRole('heading', { name: 'Sign in to Lattice' })
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('keeps the browser tab title short and the sharing title descriptive', () => {
    expect(landingHead.meta).toContainEqual({ title: 'Lattice' })
    expect(landingHead.meta).toContainEqual({
      property: 'og:title',
      content: 'Lattice — Understand your course. Not just the answer.',
    })
  })

  it('describes the product without promising exact Page attribution in metadata', () => {
    expect(landingHead.meta).toContainEqual({
      name: 'description',
      content: expect.stringContaining(
        'Citations back to your course Materials',
      ),
    })
    expect(JSON.stringify(landingHead)).not.toContain('exact Page')
  })

  it('shares the current branded PNG with matching dimensions and descriptive alt text', () => {
    const ogImage = landingHead.meta.find(
      (meta) => meta.property === 'og:image',
    )?.content
    expect(ogImage).toBeDefined()
    expect(new URL(ogImage!).pathname).toBe(
      '/landing-assets/social-preview-v2.png',
    )
    expect(landingHead.meta).toContainEqual({
      name: 'twitter:image',
      content: ogImage,
    })
    expect(landingHead.meta).toContainEqual({
      property: 'og:image:alt',
      content: 'Lattice — Understand your course. Not just the answer.',
    })
    expect(landingHead.meta).toContainEqual({
      name: 'twitter:image:alt',
      content: 'Lattice — Understand your course. Not just the answer.',
    })
    const image = readFileSync('public/landing-assets/social-preview-v2.png')
    expect(image.subarray(1, 4).toString()).toBe('PNG')
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })

  it('includes raster icons at their declared sizes', () => {
    for (const [asset, size] of [
      ['favicon-48.png', 48],
      ['apple-touch-icon.png', 180],
    ] as const) {
      const image = readFileSync(`public/${asset}`)
      expect(image.subarray(1, 4).toString()).toBe('PNG')
      expect(image.readUInt32BE(16)).toBe(size)
      expect(image.readUInt32BE(20)).toBe(size)
    }
  })

  it('is reachable from the login page', async () => {
    renderRoute('/login')
    expect(
      await screen.findByRole('link', { name: 'What is Lattice?' }),
    ).toHaveAttribute('href', '/landing')
  })
})
