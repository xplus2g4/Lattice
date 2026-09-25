import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { landingHead } from './landing-page'
import { getSessionUser } from '#/lib/auth'
import { renderRoute } from '#/test/render'

describe('landing page', () => {
  describe('signed out', () => {
    beforeEach(() => vi.mocked(getSessionUser).mockResolvedValue(null))
    afterEach(() => vi.mocked(getSessionUser).mockReset())

    it('welcomes invited students and sends access actions to the real login', async () => {
      renderRoute('/')
      await screen.findByRole('heading', {
        level: 1,
        name: /Understand your course. Not just the answer./,
      })

      const actions = [
        ...screen.getAllByRole('link', { name: 'Use your Invite' }),
        ...screen.getAllByRole('link', { name: 'Sign in' }),
      ]
      expect(actions.length).toBeGreaterThan(1)
      for (const link of actions) expect(link).toHaveAttribute('href', '/login')
      expect(screen.getByText('Private beta · Invite required')).toBeVisible()
      expect(
        screen.queryByRole('link', { name: 'Sign up' }),
      ).not.toBeInTheDocument()
    })

    it('opens the Invite form when an invited student continues', async () => {
      const user = userEvent.setup()
      const { router } = renderRoute('/')
      await user.click(
        (await screen.findAllByRole('link', { name: 'Use your Invite' }))[0],
      )

      expect(
        await screen.findByRole('textbox', { name: 'Enter your invite code' }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/login')
    })

    it('lets students explore labelled product illustrations with the keyboard', async () => {
      const user = userEvent.setup()
      renderRoute('/')
      const ask = await screen.findByRole('tab', { name: 'Ask with Citations' })
      expect(ask).toHaveAttribute('aria-selected', 'true')
      expect(
        screen.getByRole('figure', {
          name: 'Course workspace illustration',
        }),
      ).toBeVisible()
      expect(
        within(screen.getByRole('tabpanel')).getByText('Illustrative UI'),
      ).toBeVisible()

      await user.click(screen.getByRole('tab', { name: 'Private Notes' }))
      expect(
        screen.getByRole('tabpanel', { name: 'Private Notes' }),
      ).toBeVisible()
      expect(
        screen.getByRole('figure', {
          name: 'Private Notes illustration',
        }),
      ).toBeVisible()

      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('tab', { name: 'Grill me' })).toHaveFocus()
      expect(screen.getByRole('tabpanel', { name: 'Grill me' })).toBeVisible()
      expect(
        screen.getByRole('figure', { name: 'Grill me illustration' }),
      ).toBeVisible()
    })

    it('separates future direction from current features and explains beta access', async () => {
      const user = userEvent.setup()
      renderRoute('/')
      const roadmap = await screen.findByRole('region', {
        name: 'A little further ahead.',
      })
      expect(within(roadmap).getByText('Exploring')).toBeVisible()
      expect(
        within(roadmap).getByRole('heading', { name: 'Related concepts' }),
      ).toBeVisible()
      expect(
        within(roadmap).getByText(/not available in the beta/),
      ).toBeVisible()
      expect(
        within(roadmap).getByText(/not a release commitment/),
      ).toBeVisible()
      await user.click(screen.getByText('Do I need an Invite?'))
      expect(
        screen.getByText(/Your Invite lets you create an account/),
      ).toBeVisible()
      expect(screen.queryByText(/exact Page/)).not.toBeInTheDocument()
    })

    it('markets Pop quiz as in development, with a static concept preview', async () => {
      renderRoute('/')
      const popQuiz = await screen.findByRole('article', { name: 'Pop quiz' })
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
      expect(within(preview).getByText('Concept preview')).toBeVisible()
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

  it('describes the product without promising exact Page attribution in metadata', () => {
    expect(landingHead.meta).toContainEqual({
      name: 'description',
      content: expect.stringContaining(
        'Citations back to your course Materials',
      ),
    })
    expect(JSON.stringify(landingHead)).not.toContain('exact Page')
  })

  it('is reachable from the login page', async () => {
    renderRoute('/login')
    expect(
      await screen.findByRole('link', { name: 'What is Lattice?' }),
    ).toHaveAttribute('href', '/')
  })
})
