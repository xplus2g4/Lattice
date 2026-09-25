import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CloudUploadIcon,
  GoogleIcon,
  MessageQuestionIcon,
  SquareLock02Icon,
  StickyNote01Icon,
} from '@hugeicons/core-free-icons'

import { LoginGrid } from '#/components/lattice/login-grid'
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
  { icon: CloudUploadIcon, label: 'Bring your course Materials together.' },
  { icon: MessageQuestionIcon, label: 'Ask a question. Follow the Citations.' },
  { icon: StickyNote01Icon, label: 'Make space for your own Notes.' },
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
    <main className="fieldnotes-canvas flex min-h-dvh flex-col text-foreground lg:flex-row">
      <div className="flex items-center justify-between border-b border-border px-5 py-6 lg:hidden">
        <div className="flex items-center gap-3">
          <LogoMark />
          <span className="text-2xl font-semibold tracking-[-0.05em]">
            Lattice<span className="text-primary-ink">.</span>
          </span>
        </div>
        <span className="fieldnotes-kicker text-muted-foreground">
          Stay curious
        </span>
      </div>

      <section className="relative isolate hidden min-h-dvh shrink-0 flex-col justify-between gap-16 overflow-hidden bg-[#0E2622] px-10 py-12 text-white lg:flex lg:w-1/2 xl:px-16">
        <LoginGrid />
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LogoMark onDark />
            <span className="text-2xl font-semibold tracking-[-0.05em]">
              Lattice.
            </span>
          </div>
          <span className="fieldnotes-kicker text-[#8FA7A2]">
            For the curious mind
          </span>
        </div>
        <div className="relative z-10">
          <p className="fieldnotes-kicker mb-7 text-[#5CD1BE]">
            A little more understanding
          </p>
          <p className="fieldnotes-display">
            <span className="fieldnotes-reveal block">Stay curious.</span>
            <span className="fieldnotes-reveal fieldnotes-reveal-late mt-2 block italic">
              Go a little deeper.
            </span>
          </p>
          <ul className="mt-12 border-t border-[#C9DAD6]/20">
            {FEATURES.map(({ icon, label }, i) => (
              <li
                key={label}
                className="flex items-center gap-4 border-b border-[#C9DAD6]/20 py-4 text-sm text-[#C9DAD6]"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[11px] text-[#5CD1BE]"
                >
                  0{i + 1}
                </span>
                <span className="flex-1">{label}</span>
                <HugeiconsIcon
                  icon={icon}
                  className="size-[18px] shrink-0 text-[#8FA7A2]"
                  strokeWidth={1.5}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 flex items-end justify-between gap-6">
          <p className="max-w-56 text-sm leading-6 text-[#8FA7A2]">
            Built for students.
            <br />
            One course at a time.
          </p>
          <svg
            aria-hidden="true"
            viewBox="0 0 64 64"
            className="lattice-mark lattice-mark-large size-16 text-[#5CD1BE]"
            fill="none"
          >
            <g stroke="currentColor" strokeWidth="1">
              <g className="lattice-strand lattice-line-1">
                <path className="lattice-line" pathLength="1" d="M22 0v64" />
              </g>
              <g className="lattice-strand lattice-line-2">
                <path className="lattice-line" pathLength="1" d="M42 64V0" />
              </g>
              <g className="lattice-strand lattice-line-3">
                <path className="lattice-line" pathLength="1" d="M0 22h64" />
              </g>
              <g className="lattice-strand lattice-line-4">
                <path className="lattice-line" pathLength="1" d="M64 42H0" />
              </g>
            </g>
            <path
              className="lattice-mark-center"
              d="M22 22h20v20H22z"
              fill="currentColor"
            />
          </svg>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10 sm:py-16">
        <div className="flex w-full max-w-[420px] flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <Badge
              variant="outline"
              className="fieldnotes-kicker mb-3 h-auto w-fit gap-2 rounded-none border-border bg-transparent px-2 py-1 text-muted-foreground"
            >
              <HugeiconsIcon
                icon={SquareLock02Icon}
                className="size-3"
                strokeWidth={2}
              />
              Private beta
            </Badge>
            <h1 className="font-editorial text-4xl leading-tight tracking-tight sm:text-5xl">
              {invite ? 'You have been invited' : 'Sign in to Lattice'}
            </h1>
            <p className="mt-2 text-base leading-7 text-muted-foreground">
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
            className="h-13 w-full gap-3 rounded-sm border-foreground bg-card text-base font-semibold hover:bg-foreground hover:text-background"
          >
            <a href={href}>
              <HugeiconsIcon
                icon={GoogleIcon}
                className="size-5"
                strokeWidth={1.8}
              />
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
                className="flex flex-col gap-3 border-l-2 border-primary pl-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  apply()
                }}
              >
                <label
                  htmlFor="invite-code"
                  className="text-base font-semibold"
                >
                  Enter your invite code
                </label>
                <div className="flex gap-2">
                  <Input
                    id="invite-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Code or invite link"
                    className="h-12 font-mono text-base sm:text-sm"
                  />
                  <Button
                    type="submit"
                    disabled={!code.trim()}
                    className="h-12 shrink-0 px-4"
                  >
                    Join beta
                  </Button>
                </div>
                <p className="text-sm leading-snug text-muted-foreground">
                  Paste the code or the whole link from your invite. You’ll sign
                  in with Google next.
                </p>
              </form>

              <p className="text-sm text-muted-foreground">
                No invite yet? Ask an instructor for an invite link.{' '}
                <Link
                  to="/"
                  className="fieldnotes-action font-medium text-foreground underline"
                >
                  What is Lattice?
                </Link>
              </p>
            </>
          )}

          {import.meta.env.VITE_DEV_FAKE_AUTH === 'true' && (
            <form
              className="flex flex-col gap-2.5 border border-dashed border-border bg-feedback-developing p-4"
              action="/auth/dev"
              method="get"
            >
              <div className="flex items-center gap-2">
                <span className="border border-current px-1.5 py-0.5 font-mono text-[11px] font-medium text-feedback-developing-text">
                  DEV ONLY
                </span>
                <label
                  htmlFor="devemail"
                  className="text-sm text-feedback-developing-text"
                >
                  Skip Google with a test email
                </label>
              </div>
              <div className="flex gap-2">
                <Input
                  id="devemail"
                  name="email"
                  placeholder="you@example.com"
                  className="h-11 rounded-sm border-input"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="h-11 shrink-0 rounded-sm border-input"
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
