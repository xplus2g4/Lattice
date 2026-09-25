import { createFileRoute } from '@tanstack/react-router'

import { redirect, session } from '#/lib/auth.server'

export const Route = createFileRoute('/auth/logout')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const s = await session()
        await s.clear()
        return redirect(`${new URL(request.url).origin}/login`)
      },
    },
  },
})
