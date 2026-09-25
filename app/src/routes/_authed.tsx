import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { LandingPage, landingHead } from '#/components/landing/landing-page'
import { TopBar } from '#/components/lattice/top-bar'
import { getSessionUser } from '#/lib/auth'

// Everything under _authed needs a session; /login, /invite and /auth stay public.
// The one exception is `/` itself, which shows the landing page to a signed-out visitor.
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getSessionUser()
    if (!user && location.pathname !== '/')
      throw redirect({
        to: '/login',
        search: { error: undefined, invite: undefined },
      })
    return { user }
  },
  head: ({ match }) => (match.context.user ? {} : landingHead),
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  // The course workspace is its own full-height app shell with its own nav, so the shared
  // top bar and page canvas step aside for it; every other signed-in page gets both.
  const isWorkspace = useRouterState({
    select: (s) => s.location.pathname.startsWith('/courses/'),
  })
  if (!user) return <LandingPage />
  if (isWorkspace) return <Outlet />
  return (
    <div className="fieldnotes-canvas flex min-h-screen flex-col">
      <TopBar />
      <Outlet />
    </div>
  )
}
