import { randomBytes } from 'node:crypto'

import { createFileRoute } from '@tanstack/react-router'

import { googleAuthUrl, pkce, redirect, session } from '#/lib/auth.server'

export const Route = createFileRoute('/auth/google/')({
  server: {
    handlers: {
      // Send the user to Google. Any ?invite= rides along in the session and is
      // redeemed after the callback establishes who signed in.
      GET: async ({ request }) => {
        const invite = new URL(request.url).searchParams.get('invite')
        const { verifier, challenge } = pkce()
        const state = randomBytes(16).toString('base64url')
        const s = await session()
        await s.update({
          oauthState: state,
          codeVerifier: verifier,
          ...(invite ? { pendingInvite: invite } : {}),
        })
        return redirect(googleAuthUrl(state, challenge))
      },
    },
  },
})
