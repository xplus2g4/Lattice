import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CloudUploadIcon,
  MessageQuestionIcon,
  Quiz01Icon,
  StickyNote01Icon,
} from '@hugeicons/core-free-icons'

import { LoginGrid } from '#/components/lattice/login-grid'
import { LogoMark } from '#/components/lattice/top-bar'
import { Button } from '#/components/ui/button'

const LOGIN = { error: undefined, invite: undefined }

const FEATURES = [
  {
    icon: CloudUploadIcon,
    title: 'Bring your course Materials together.',
    body: 'Slides, tutorials and memos for a course live in one place, shared with everyone enrolled in it.',
  },
  {
    icon: MessageQuestionIcon,
    title: 'Ask a question. Follow the Citations.',
    body: 'Answers come from your course’s own Materials, and every Citation points back to the Page it came from. Related concepts come alongside each answer.',
  },
  {
    icon: StickyNote01Icon,
    title: 'Make space for your own Notes.',
    body: 'Write Notes or add your own PDFs. They are private to you, and Lattice draws on them when it answers your questions.',
  },
  {
    icon: Quiz01Icon,
    title: 'Grill me when you are ready.',
    body: 'Pick what to be tested on and get about ten questions grounded in your course’s Materials, with a summary of how you did on each Topic.',
  },
]

const STEPS = [
  [
    'Get an Invite',
    'Lattice is in private beta. Ask an instructor for an invite code or link.',
  ],
  [
    'Sign up',
    'Enter your invite code, then continue with your Google account.',
  ],
  [
    'Open your course',
    'Type your course code and start reading, asking and taking Notes.',
  ],
]

function SignUp({ onDark = false }: { onDark?: boolean }) {
  return (
    <Button
      asChild
      className={`h-12 rounded-sm px-6 text-base font-semibold ${onDark ? 'focus-visible:outline-[#5CD1BE]' : ''}`}
    >
      <Link to="/login" search={LOGIN}>
        Sign up
      </Link>
    </Button>
  )
}

export function LandingPage() {
  return (
    <div className="fieldnotes-canvas min-h-dvh text-foreground">
      <header className="border-b border-border px-5 sm:px-10">
        <div className="mx-auto flex min-h-20 max-w-[1200px] items-center justify-between gap-4">
          <Link to="/landing" className="flex min-h-11 items-center gap-3">
            <LogoMark />
            <span className="text-2xl font-semibold tracking-[-0.05em]">
              Lattice<span className="text-primary-ink">.</span>
            </span>
            <span className="fieldnotes-kicker ml-4 hidden border-l border-border pl-5 text-muted-foreground md:block">
              For the curious mind
            </span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <a
              href="#how-it-works"
              className="fieldnotes-action hidden text-sm font-medium sm:inline"
            >
              How it works
            </a>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-sm border-foreground bg-card font-semibold hover:bg-foreground hover:text-background"
            >
              <Link to="/login" search={LOGIN}>
                Sign in
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden bg-[#0E2622] px-5 py-20 text-white sm:px-10 lg:py-28">
          <LoginGrid />
          <div className="relative z-10 mx-auto max-w-[1200px]">
            <p className="fieldnotes-kicker mb-7 text-[#5CD1BE]">
              A little more understanding
            </p>
            <h1 className="fieldnotes-display max-w-4xl">
              <span className="fieldnotes-reveal block">Stay curious.</span>
              <span className="fieldnotes-reveal fieldnotes-reveal-late mt-2 block italic">
                Go a little deeper.
              </span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-8 text-[#C9DAD6]">
              Lattice answers questions about your course from its own Materials
              and your Notes, with Citations back to the exact Page.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-6">
              <SignUp onDark />
              <a
                href="#how-it-works"
                className="group fieldnotes-action text-sm font-medium text-[#C9DAD6]"
              >
                See how it works <span className="fieldnotes-arrow">→</span>
              </a>
            </div>
            <p className="fieldnotes-kicker mt-6 text-[#8FA7A2]">
              Private beta · Invite only
            </p>
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="features-title"
          className="scroll-mt-4 px-5 py-20 sm:px-10"
        >
          <div className="mx-auto grid max-w-[1200px] gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="fieldnotes-kicker mb-4 text-primary-ink">
                What you can do
              </p>
              <h2
                id="features-title"
                className="font-editorial text-4xl leading-tight tracking-tight sm:text-5xl"
              >
                One course at a time.
              </h2>
              <p className="mt-4 max-w-sm text-base leading-7 text-muted-foreground">
                Everything in Lattice belongs to a single course, so answers
                stay grounded in what you are actually being taught.
              </p>
            </div>
            <ul className="border-t border-border">
              {FEATURES.map(({ icon, title, body }, i) => (
                <li
                  key={title}
                  className="grid grid-cols-[auto_1fr_auto] gap-x-5 gap-y-2 border-b border-border py-6"
                >
                  <span
                    aria-hidden="true"
                    className="pt-1 font-mono text-[11px] text-primary-ink"
                  >
                    0{i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      {body}
                    </p>
                  </div>
                  <HugeiconsIcon
                    icon={icon}
                    className="size-5 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          aria-labelledby="join-title"
          className="border-t border-border px-5 py-20 sm:px-10"
        >
          <div className="mx-auto max-w-[1200px]">
            <p className="fieldnotes-kicker mb-4 text-primary-ink">
              Getting started
            </p>
            <h2
              id="join-title"
              className="font-editorial text-4xl leading-tight tracking-tight sm:text-5xl"
            >
              Three steps in.
            </h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map(([title, body], i) => (
                <li
                  key={title}
                  className="flex flex-col gap-2 border-l-2 border-primary pl-5"
                >
                  <span className="fieldnotes-kicker text-muted-foreground">
                    Step 0{i + 1}
                  </span>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {body}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-12 flex flex-wrap items-center gap-6">
              <SignUp />
              <p className="text-sm text-muted-foreground">
                Already in the beta?{' '}
                <Link
                  to="/login"
                  search={LOGIN}
                  className="fieldnotes-action font-medium text-foreground underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-8 sm:px-10">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span>Built for students. One course at a time.</span>
          </div>
          <span className="fieldnotes-kicker">Stay curious</span>
        </div>
      </footer>
    </div>
  )
}
