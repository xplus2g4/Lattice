import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

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
  component: () => <Outlet />,
})
