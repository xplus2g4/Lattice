import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { TopBar } from '#/components/lattice/top-bar'
import { getSessionUser } from '#/lib/auth'

// Everything under _authed needs a session; /login, /invite and /auth stay public.
export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    const user = await getSessionUser()
    if (!user)
      throw redirect({
        to: '/login',
        search: { error: undefined, invite: undefined },
      })
    return { user }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  // The course workspace is its own full-height app shell with its own nav, so the shared
  // top bar and page canvas step aside for it; every other signed-in page gets both.
  const isWorkspace = useRouterState({
    select: (s) => s.location.pathname.startsWith('/courses/'),
  })
  if (isWorkspace) return <Outlet />
  return (
    <div className="flex min-h-screen flex-col bg-[#F6F8F7]">
      <TopBar />
      <Outlet />
    </div>
  )
}
