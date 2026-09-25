import { createFileRoute } from '@tanstack/react-router'

import { apiCall, mintToken, redirect, session } from '#/lib/auth.server'

export const Route = createFileRoute('/auth/dev')({
  server: {
    handlers: {
      // Dev-only sign-in: writes the session directly, skipping the Google round
      // trip so switching accounts is one URL. Dead unless VITE_DEV_FAKE_AUTH=true.
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const fail = () => redirect(`${url.origin}/login?error=auth`)
        if (process.env.VITE_DEV_FAKE_AUTH !== 'true') {
          return new Response('not found', { status: 404 })
        }
        const email = url.searchParams.get('email')?.trim().toLowerCase()
        if (!email || !email.includes('@')) return fail()

        const s = await session()
        const sub = `dev|${email}`
        // Redeem the shared dev code so the API admits a brand-new email;
        // existing users sail through redeem's early return either way.
        const { token } = await mintToken({ sub, email })
        const res = await apiCall('/invites.redeem', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: process.env.DEV_INVITE_CODE ?? '' }),
        })
        if (!res.ok) {
          await s.clear()
          return fail()
        }
        await s.update({ sub, email })
        return redirect(`${url.origin}/`)
      },
    },
  },
})
