import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { meQuery, signInDev, signInWithGoogle, useMe } from '#/lib/auth'

export const Route = createFileRoute('/login')({ component: Login })

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  string | undefined

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            el: HTMLElement,
            options: Record<string, unknown>,
          ) => void
        }
      }
    }
  }
}

function Login() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const googleButton = useRef<HTMLDivElement>(null)

  const signIn = useMutation({
    mutationFn: (args: { credential: string } | { email: string }) =>
      'credential' in args
        ? signInWithGoogle(args.credential, code)
        : signInDev(args.email, code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey })
      void navigate({ to: '/' })
    },
  })

  // The Google button renders itself: load GSI once, point it at this card.
  const { mutate } = signIn
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButton.current) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      const el = googleButton.current
      if (!el || !window.google) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => mutate({ credential: response.credential }),
      })
      window.google.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        width: 280,
      })
    }
    document.head.appendChild(script)
  }, [mutate])

  // Dev sign-in is the fallback when Google isn't configured, and always
  // available in `vite dev` for exercising the flow without OAuth.
  const showDev = import.meta.env.DEV || !GOOGLE_CLIENT_ID

  if (me.data) return <Navigate to="/" />

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 px-6 py-8">
          <div className="space-y-2 text-center">
            <p className="text-lattice-meta font-semibold tracking-[0.18em] text-primary">
              LATTICE
            </p>
            <h1 className="text-lattice-heading font-semibold tracking-tight">
              Sign in to study
            </h1>
            <p className="text-sm text-muted-foreground">
              First time? Enter the invitation code your instructor shared.
            </p>
          </div>

          <Input
            value={code}
            placeholder="Invitation code"
            onChange={(e) => setCode(e.target.value)}
          />

          {GOOGLE_CLIENT_ID && (
            <div ref={googleButton} className="flex justify-center" />
          )}

          {showDev && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (email.trim()) signIn.mutate({ email: email.trim() })
              }}
            >
              {GOOGLE_CLIENT_ID && (
                <p className="text-center text-lattice-meta text-muted-foreground">
                  or a dev email
                </p>
              )}
              <Input
                type="email"
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={!email.trim() || signIn.isPending}
              >
                {signIn.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}

          {signIn.error && (
            <p className="text-center text-sm text-destructive">
              {signIn.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
