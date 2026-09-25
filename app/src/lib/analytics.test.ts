import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trackPageView } from '#/lib/analytics'

describe('a page view', () => {
  const gtag = vi.fn()

  beforeEach(() => {
    gtag.mockClear()
    window.gtag = gtag
    window.history.replaceState(
      null,
      '',
      '/courses/cs101?material=week1.pdf&page=3',
    )
  })

  it('carries the route id and nothing from the current location', () => {
    trackPageView('/courses/$course/')
    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_path: '/courses/$course/',
      page_location: `${window.location.origin}/courses/$course/`,
    })
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/cs101|week1/)
  })

  it('is never sent for the dev sandbox or the foundation page', () => {
    trackPageView('/dev')
    trackPageView('/foundation/')
    expect(gtag).not.toHaveBeenCalled()
  })
})
