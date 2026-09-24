import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'

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
