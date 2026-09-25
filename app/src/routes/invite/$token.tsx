import { createFileRoute, redirect } from '@tanstack/react-router'

// An invite link carries its token into the sign-in flow; the OAuth callback
// redeems it once Google has proven who the invitee is.
export const Route = createFileRoute('/invite/$token')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/login',
      search: { error: undefined, invite: params.token },
    })
  },
})
