import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'
import { initAnalytics, trackPageView } from './lib/analytics'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    // Not in the course workspace, which keeps its own scroll. The router remembers
    // elements by their DOM path, and tabs take turns at the same path, so restoring
    // would hand one tab another's position (and the reader would save it).
    scrollRestoration: ({ location }) =>
      !location.pathname.startsWith('/courses/'),
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  // The server builds a router too; page views are a browser matter.
  const measurementId: string | undefined = import.meta.env
    .VITE_GA_MEASUREMENT_ID
  if (measurementId && typeof window !== 'undefined') {
    initAnalytics(measurementId)
    // `onRendered` is the one event a fully server-rendered first page also emits (once,
    // from the mount, with `pathChanged` false; `onResolved` never fires for it). After
    // that, only path changes are page views: switching a tab or jumping to a Page is a
    // search-only navigation. Matches are committed by then, so the last is the leaf.
    let first = true
    router.subscribe('onRendered', ({ pathChanged }) => {
      if (!first && !pathChanged) return
      first = false
      const leaf = router.state.matches.at(-1)
      if (leaf) trackPageView(leaf.routeId)
    })
  }

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
  interface HistoryState {
    /** Bumped by each Page link click, so revisiting the current Page scrolls to it again. */
    jump?: number
  }
}
