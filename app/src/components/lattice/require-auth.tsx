/** The gate that keeps the app behind a session.
 *
 * Wrap a route's component with `authed`: while `meQuery` is in flight a plain
 * loading screen shows; on a refused `/me.get` (after the refresh retry inside
 * `apiFetch`) the app sends the visitor to `/login`.
 */
import { Navigate } from '@tanstack/react-router'

import { MOCK_API, useMe } from '#/lib/auth'

import type { ComponentType, ReactNode } from 'react'

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  if (MOCK_API) return children
  if (me.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Signing in…</p>
      </main>
    )
  }
  if (me.isError) return <Navigate to="/login" />
  return children
}

/** Route component wrapper: `component: authed(Home)`. */
export function authed(Component: ComponentType) {
  return function AuthedRoute() {
    return (
      <RequireAuth>
        <Component />
      </RequireAuth>
    )
  }
}
