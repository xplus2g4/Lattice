import { createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'

const ERRORS: Record<string, string> = {
  auth: 'Sign-in failed, please try again.',
  invite: 'That invite is invalid, expired or already used.',
  no_invite: 'This app is invite-only. Ask an instructor for an invite link.',
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
    invite: typeof search.invite === 'string' ? search.invite : undefined,
  }),
  component: Login,
})

function Login() {
  const { error, invite } = Route.useSearch()
  const href = invite ? `/auth/google?invite=${invite}` : '/auth/google'
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-6 py-8 text-center">
          <div>
            <p className="text-lattice-meta font-semibold tracking-[0.18em] text-primary">
              LATTICE
            </p>
            <h1 className="mt-3 text-lattice-heading font-semibold tracking-tight">
              {invite ? 'You have been invited' : 'Sign in to continue'}
            </h1>
          </div>
          {error && (
            <p className="text-sm text-destructive">
              {ERRORS[error] ?? 'Sign-in failed, please try again.'}
            </p>
          )}
          <Button asChild size="lg" className="w-full">
            <a href={href}>Sign in with Google</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
