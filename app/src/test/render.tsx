import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'

import { routeTree } from '#/routeTree.gen'

import type { ReactElement } from 'react'

// Retries off: a test asserting on an error state should see it on the first response
// rather than after Query's backoff.
export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  }
}

/** Mounts the real route tree at `path`, so what is under test is the routing itself:
 * which sections a URL shows, and where a navigation ends up. */
export function renderRoute(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPendingMinMs: 0,
  })
  return {
    router,
    queryClient,
    // In the app the provider comes from the SSR-Query integration in router.tsx; here
    // the router is built by hand, so the provider has to be too.
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    ),
  }
}
