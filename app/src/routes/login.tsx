import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'

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
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const href = invite ? `/auth/google?invite=${invite}` : '/auth/google'

  // Accept the raw token or a pasted /invite/<token> link; the invite route
  // bounces back here with ?invite= set, so both paths converge.
  const apply = () => {
    const token = code.trim().split('/invite/').pop()?.split(/[?#]/)[0]?.trim()
    if (token) navigate({ to: '/invite/$token', params: { token } })
  }

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
          {import.meta.env.VITE_DEV_FAKE_AUTH === 'true' && (
            <div className="space-y-2 border-t border-border pt-6">
              <p className="text-xs text-muted-foreground">
                Dev sign-in — skips Google (VITE_DEV_FAKE_AUTH)
              </p>
              <form className="flex gap-2" action="/auth/dev" method="get">
                <Input name="email" placeholder="you@example.com" />
                <Button type="submit" variant="outline">
                  Sign in
                </Button>
              </form>
            </div>
          )}
          {!invite && (
            <div className="space-y-2 border-t border-border pt-6">
              <p className="text-xs text-muted-foreground">
                Have an invite code or link?
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  apply()
                }}
              >
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste it here"
                />
                <Button type="submit" variant="outline" disabled={!code.trim()}>
                  Apply
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
