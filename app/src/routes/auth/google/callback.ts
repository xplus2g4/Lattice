import { createFileRoute } from '@tanstack/react-router'

import {
  apiCall,
  exchangeCode,
  mintToken,
  redirect,
  session,
  verifyGoogleId,
} from '#/lib/auth.server'

export const Route = createFileRoute('/auth/google/callback')({
  server: {
    handlers: {
      // Google sends the user back here. Verify who they are, then only let them
      // in if they hold an account or a usable invite — strangers get bounced.
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const fail = (reason: string) =>
          redirect(`${url.origin}/login?error=${reason}`)

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const s = await session()
        const saved = s.data
        if (
          url.searchParams.get('error') ||
          !code ||
          !state ||
          state !== saved.oauthState ||
          !saved.codeVerifier
        ) {
          await s.clear()
          return fail('auth')
        }

        try {
          const { id_token } = await exchangeCode(code, saved.codeVerifier)
          const user = await verifyGoogleId(id_token)
          const { token } = await mintToken(user)

          if (saved.pendingInvite) {
            const res = await apiCall('/invites.redeem', token, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: saved.pendingInvite }),
            })
            if (res.status === 403) {
              await s.clear()
              return fail('invite')
            }
            if (!res.ok) throw new Error(`invite redeem: ${res.status}`)
          } else {
            // No invite pending: only existing accounts (and the configured
            // instructor, who bootstraps on first sign-in) may hold a session.
            const res = await apiCall('/me.get', token)
            if (res.status === 403) {
              await s.clear()
              return fail('no_invite')
            }
            if (!res.ok) throw new Error(`me.get: ${res.status}`)
          }

          await s.update({
            sub: user.sub,
            email: user.email,
            name: user.name,
            picture: user.picture,
            oauthState: undefined,
            codeVerifier: undefined,
            pendingInvite: undefined,
          })
          return redirect(`${url.origin}/`)
        } catch {
          await s.clear()
          return fail('auth')
        }
      },
    },
  },
})
