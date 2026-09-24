import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CloudUploadIcon,
  GoogleIcon,
  MessageQuestionIcon,
  SquareLock02Icon,
  StickyNote01Icon,
} from '@hugeicons/core-free-icons'

import { LogoMark } from '#/components/lattice/top-bar'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

const ERRORS: Record<string, string> = {
  auth: 'Sign-in failed, please try again.',
  invite: 'That invite is invalid, expired or already used.',
  no_invite: 'This app is invite-only. Ask an instructor for an invite link.',
}

const FEATURES = [
  { icon: CloudUploadIcon, label: 'Upload slides and readings for each course' },
  { icon: MessageQuestionIcon, label: 'Ask questions and get answers from your own materials' },
  { icon: StickyNote01Icon, label: 'Keep notes next to what you’re reading' },
]

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
    <main className="flex min-h-screen bg-background text-foreground">
      <section className="hidden shrink-0 flex-col justify-between bg-[#0E2622] px-16 py-14 text-white lg:flex lg:w-[560px]">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-xl font-bold tracking-tight">Lattice</span>
        </div>
        <div className="flex flex-col gap-7">
          <h1 className="text-5xl font-bold leading-[1.08] tracking-tight">
            Your course materials, ready to answer back.
          </h1>
          <ul className="flex flex-col gap-4.5">
            {FEATURES.map(({ icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-3.5 text-[17px] text-[#C9DAD6]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#5CD1BE]/15">
                  <HugeiconsIcon
                    icon={icon}
                    className="size-[18px] text-[#5CD1BE]"
                    strokeWidth={1.8}
                  />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-[#8FA7A2]">
          Built for students, one course at a time.
        </p>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="flex w-full max-w-sm flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <Badge className="w-fit gap-1.5 bg-[#E6F4F1] px-2.5 py-1 text-[#0F5F53] hover:bg-[#E6F4F1]">
              <HugeiconsIcon icon={SquareLock02Icon} className="size-3" strokeWidth={2} />
              Private beta
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight">
              {invite ? 'You have been invited' : 'Sign in to Lattice'}
            </h2>
            <p className="text-[17px] text-muted-foreground">
              {invite
                ? 'Continue with the Google account you were invited with.'
                : 'Already in the beta? Continue with the Google account you were invited with.'}
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">
              {ERRORS[error] ?? 'Sign-in failed, please try again.'}
            </p>
          )}

          <Button
            asChild
            variant="outline"
            className="h-13 w-full gap-3 rounded-full border-border text-base font-semibold"
          >
            <a href={href}>
              <HugeiconsIcon icon={GoogleIcon} className="size-5" strokeWidth={1.8} />
              Continue with Google
            </a>
          </Button>

          {!invite && (
            <>
              <div className="flex items-center gap-3.5 text-sm text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>New here?</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <form
                className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  apply()
                }}
              >
                <label htmlFor="invite-code" className="text-base font-semibold">
                  Enter your invite code
                </label>
                <div className="flex gap-2">
                  <Input
                    id="invite-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Code or invite link"
                    className="h-12 rounded-xl font-mono text-sm"
                  />
                  <Button
                    type="submit"
                    disabled={!code.trim()}
                    className="h-12 shrink-0 rounded-xl px-5"
                  >
                    Join beta
                  </Button>
                </div>
                <p className="text-sm leading-snug text-muted-foreground">
                  Paste the code or the whole link from your invite. You’ll sign in
                  with Google next.
                </p>
              </form>

              <p className="text-sm text-muted-foreground">
                No invite yet? Ask an instructor for an invite link.
              </p>
            </>
          )}

          {import.meta.env.VITE_DEV_FAKE_AUTH === 'true' && (
            <form
              className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[#E4C77A] bg-[#FFFBEF] p-4"
              action="/auth/dev"
              method="get"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[#F6E3AE] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#6B4700]">
                  DEV ONLY
                </span>
                <label htmlFor="devemail" className="text-sm text-[#6B5A2E]">
                  Skip Google with a test email
                </label>
              </div>
              <div className="flex gap-2">
                <Input
                  id="devemail"
                  name="email"
                  placeholder="you@example.com"
                  className="h-11 rounded-lg border-[#E9D9A8]"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="h-11 shrink-0 rounded-lg border-[#E9D9A8]"
                >
                  Sign in
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
