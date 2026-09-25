import { useId, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  FlowConnectionIcon,
  MessageQuestionIcon,
  Quiz01Icon,
  StickyNote01Icon,
} from '@hugeicons/core-free-icons'

import { ProductIllustration } from './product-illustration'
import { LoginGrid } from '#/components/lattice/login-grid'
import { LogoMark } from '#/components/lattice/top-bar'
import { Button } from '#/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'

const LOGIN = { error: undefined, invite: undefined }

// Configure the public origin at build time so crawlers receive absolute URLs.
const origin = new URL(import.meta.env.VITE_SITE_URL || 'http://localhost:3000')
const siteUrl = new URL('/landing', origin).href
const imageUrl = new URL('/landing-assets/social-preview-v2.png', origin).href
const pageTitle = 'Lattice — Understand your course. Not just the answer.'
const description =
  'Read, ask and practise in one course workspace, with private Notes and Citations back to your course Materials. Join the private beta with your Invite.'

/** Metadata for `/landing`, where a signed-out visitor to `/` is sent. */
export const landingHead = {
  meta: [
    { title: 'Lattice' },
    { name: 'description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Lattice' },
    { property: 'og:locale', content: 'en_SG' },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: description },
    { property: 'og:url', content: siteUrl },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:type', content: 'image/png' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: pageTitle },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: description },
    { name: 'twitter:url', content: siteUrl },
    { name: 'twitter:image', content: imageUrl },
    { name: 'twitter:image:alt', content: pageTitle },
  ],
  links: [{ rel: 'canonical', href: siteUrl }],
}

const FEATURES = [
  {
    id: 'ask',
    icon: MessageQuestionIcon,
    label: 'Ask with Citations',
    title: 'An explanation you can follow back.',
    body: 'Ask about what you are studying, with your course Materials open beside the answer. Follow its Citations to read the supporting Material for yourself.',
    detail: 'Less switching between tabs. More time making sense of the idea.',
    illustration: 'Ask and Citations',
  },
  {
    id: 'notes',
    icon: StickyNote01Icon,
    label: 'Private Notes',
    title: 'Your course. Your own way of understanding it.',
    body: 'Write a Note or add a PDF of your own notes. Keep your thinking beside the course Materials, and let Lattice draw on it when answering your questions.',
    detail:
      'Materials are shared with enrolled students. Your Notes are private to you.',
    illustration: 'Private Notes',
  },
  {
    id: 'grill',
    icon: Quiz01Icon,
    label: 'Grill me',
    title: 'Go from “that makes sense” to “I can explain it.”',
    body: 'Choose a Material and practise with questions grounded in it. Submit your answers, read the feedback and return to the ideas that need another look.',
    detail: 'A chance to check your understanding, not just reread the answer.',
    illustration: 'Grill me',
  },
  {
    id: 'related',
    icon: FlowConnectionIcon,
    label: 'Related courses',
    title: 'The same idea, as another course teaches it.',
    body: 'Ask in your course and Lattice also checks the Materials of up to three Related courses, the ones nearest to yours. Their answer sits apart under its own course code, so you can compare how each course explains the same idea.',
    detail:
      'See what a Related course’s slides say about the idea you asked about.',
    illustration: 'Related courses',
  },
] as const

const STEPS = [
  [
    'Join the Telegram group',
    'Lattice is in private beta. Join the group and we will send you an Invite link there.',
  ],
  [
    'Use your Invite',
    'Open the Invite link, or enter it on the sign-in page. Then continue with your Google account.',
  ],
  [
    'Find your course and ask',
    'Search for your course code and join it. Open a Material, ask about an idea and follow the Citations.',
  ],
]

const FAQS = [
  [
    'Do I need an Invite?',
    'Yes. Lattice is in private beta. Your Invite lets you create an account with Google. Already joined? Just sign in; you do not need another Invite. If you have not received one, join the Telegram group and we will send you one.',
  ],
  [
    'Does my Invite include a course?',
    'No. An Invite gives you access to Lattice, not Enrolment in a particular course. After signing in, search for your course code to see whether it is available and join it.',
  ],
  [
    'Who can read my Notes?',
    'Your Notes are private to you, unlike the course Materials shared with enrolled students. Lattice can draw on your Notes to answer your questions; they are not shared with classmates.',
  ],
  [
    'Can an answer be wrong?',
    'Yes. AI-generated explanations can make mistakes. Use the Citations to check the supporting Materials. Page locations may be approximate or unavailable, so treat answers as a study aid rather than an authority.',
  ],
  [
    'What if my Invite does not work?',
    'Invites expire and can only be used once. If you already created an account, sign in with the same Google account. Otherwise, ask in the Telegram group for a new one.',
  ],
]

const BETA_URL = 'https://t.me/lattice_private_beta'

function BetaAction({ onDark = false }: { onDark?: boolean }) {
  return (
    <Button
      asChild
      className={`h-12 rounded-sm px-6 text-base font-semibold ${onDark ? 'focus-visible:outline-[#5CD1BE]' : ''}`}
    >
      <a href={BETA_URL} target="_blank" rel="noopener noreferrer">
        Join Private Beta
      </a>
    </Button>
  )
}

export function LandingPage() {
  const [featureId, setFeatureId] = useState('ask')
  const motionId = useId()
  const reduceMotion = useReducedMotion() ?? true

  return (
    <div className="fieldnotes-canvas min-h-dvh text-foreground">
      <header className="border-b border-border px-5 sm:px-10">
        <div className="mx-auto flex min-h-20 max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <Link to="/landing" className="flex min-h-11 items-center gap-3">
            <LogoMark />
            <span className="text-2xl font-semibold tracking-[-0.05em]">
              Lattice<span className="text-primary-ink">.</span>
            </span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-3 sm:gap-6"
          >
            <a
              href="#how-it-works"
              className="fieldnotes-action hidden py-3 text-sm font-medium sm:inline"
            >
              How it works
            </a>
            <a
              href="#roadmap"
              className="fieldnotes-action py-3 text-sm font-medium"
            >
              Roadmap
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
        <section className="relative isolate overflow-hidden bg-[#0E2622] px-5 py-16 text-white sm:px-10 lg:py-24">
          <LoginGrid />
          <div className="relative z-10 mx-auto grid max-w-[1200px] items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
            <div className="min-w-0">
              <p className="fieldnotes-kicker mb-6 text-[#5CD1BE]">
                Your course. A little clearer.
              </p>
              <h1 className="font-editorial text-[clamp(2.75rem,4.6vw,4.5rem)] leading-[1.05] tracking-[-0.045em]">
                <span className="fieldnotes-reveal block">
                  Understand your course.
                </span>{' '}
                <span className="fieldnotes-reveal fieldnotes-reveal-late mt-2 block italic text-[#C9DAD6]">
                  Not just the answer.
                </span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-[#C9DAD6]">
                Read your course Materials, ask questions grounded in them and
                your private Notes, and follow Citations back to what you’re
                studying.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <BetaAction onDark />
                <a
                  href="#how-it-works"
                  className="group fieldnotes-action py-3 text-sm font-medium text-[#C9DAD6]"
                >
                  Explore the workspace{' '}
                  <span aria-hidden="true" className="fieldnotes-arrow">
                    →
                  </span>
                </a>
              </div>
              <p className="fieldnotes-kicker mt-5 text-[#8FA7A2]">
                Private beta · Invite required
              </p>
            </div>
            <ProductIllustration kind="workspace" title="Course workspace" />
          </div>
        </section>

        <div className="border-b border-border px-5 sm:px-10">
          <ul className="mx-auto grid max-w-[1200px] gap-4 py-6 text-sm font-medium sm:grid-cols-3 sm:gap-8">
            {[
              'Course Materials, together',
              'Your Notes, kept private',
              'Understanding, put into practice',
            ].map((benefit, i) => (
              <li key={benefit} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="font-mono text-xs text-primary-ink"
                >
                  0{i + 1}
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>

        <section
          id="how-it-works"
          aria-labelledby="product-title"
          className="scroll-mt-6 px-5 py-16 sm:px-10 lg:py-24"
        >
          <div className="mx-auto max-w-[1200px]">
            <p className="fieldnotes-kicker mb-4 text-primary-ink">
              Inside Lattice
            </p>
            <h2
              id="product-title"
              className="font-editorial text-4xl tracking-tight sm:text-5xl"
            >
              One place to work it out.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              From the first question to a little more confidence. Keep your
              reading, thinking and practice in the same course workspace.
            </p>
            <LayoutGroup id={motionId}>
              <Tabs
                value={featureId}
                onValueChange={setFeatureId}
                orientation="vertical"
                className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)] lg:gap-12"
              >
                <TabsList
                  aria-label="Explore Lattice features"
                  className="flex h-auto min-w-0 w-full flex-col items-stretch justify-start gap-3 bg-transparent p-0"
                >
                  {FEATURES.map(({ id, icon, label, detail }, i) => (
                    <TabsTrigger
                      key={id}
                      value={id}
                      aria-label={label}
                      className="h-auto min-w-0 w-full max-w-full flex-none flex-col items-start gap-3 whitespace-normal border border-border bg-card/40 px-5 py-5 text-left text-foreground transition-[background-color,border-color,box-shadow] duration-200 hover:border-primary-ink/40 hover:bg-card hover:shadow-sm motion-reduce:transition-none data-[state=active]:bg-card data-[state=active]:shadow-lattice"
                    >
                      {featureId === id && (
                        <motion.span
                          aria-hidden="true"
                          layoutId={
                            reduceMotion ? undefined : 'feature-indicator'
                          }
                          initial={false}
                          transition={{
                            duration: reduceMotion ? 0 : 0.22,
                            ease: 'easeOut',
                          }}
                          className="pointer-events-none absolute inset-y-4 left-0 w-0.5 rounded-full bg-primary-ink"
                        />
                      )}
                      <span className="flex w-full items-center gap-3">
                        <HugeiconsIcon
                          icon={icon}
                          aria-hidden="true"
                          className="size-5 text-primary-ink"
                        />
                        <span className="flex-1 text-base font-semibold">
                          {label}
                        </span>
                        <span
                          aria-hidden="true"
                          className="font-mono text-xs text-muted-foreground"
                        >
                          0{i + 1}
                        </span>
                      </span>
                      <span className="text-sm font-normal leading-6 text-muted-foreground">
                        {detail}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="grid min-w-0 items-start">
                  {FEATURES.map((feature) => {
                    const active = featureId === feature.id
                    return (
                      <TabsContent
                        key={feature.id}
                        value={feature.id}
                        forceMount
                        aria-hidden={!active}
                        inert={!active}
                        style={{ visibility: active ? 'visible' : 'hidden' }}
                        className="col-start-1 row-start-1 min-w-0"
                      >
                        <motion.div
                          initial={false}
                          animate={{
                            opacity: active ? 1 : 0,
                            y: active || reduceMotion ? 0 : 6,
                          }}
                          transition={{
                            duration: reduceMotion ? 0 : 0.2,
                            ease: 'easeOut',
                          }}
                          className="space-y-6"
                        >
                          <ProductIllustration
                            kind={feature.id}
                            title={feature.illustration}
                          />
                          <div>
                            <h3 className="font-editorial text-2xl leading-tight tracking-tight sm:text-3xl">
                              {feature.title}
                            </h3>
                            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                              {feature.body}
                            </p>
                          </div>
                        </motion.div>
                      </TabsContent>
                    )
                  })}
                </div>
              </Tabs>
            </LayoutGroup>
          </div>
        </section>

        <section
          aria-labelledby="join-title"
          className="border-y border-border bg-card/60 px-5 py-16 sm:px-10 lg:py-20"
        >
          <div className="mx-auto max-w-[1200px]">
            <p className="fieldnotes-kicker mb-4 text-primary-ink">
              Getting started
            </p>
            <h2
              id="join-title"
              className="font-editorial text-4xl tracking-tight sm:text-5xl"
            >
              Join the group. We send you the Invite.
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map(([title, body], i) => (
                <li
                  key={title}
                  className="flex flex-col gap-3 border-l-2 border-primary pl-5"
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
          </div>
        </section>

        <section
          id="roadmap"
          aria-labelledby="roadmap-title"
          className="scroll-mt-6 px-5 py-16 sm:px-10 lg:py-24"
        >
          <div className="mx-auto max-w-[1200px]">
            <p className="fieldnotes-kicker mb-4 text-primary-ink">Roadmap</p>
            <h2
              id="roadmap-title"
              className="font-editorial text-4xl tracking-tight sm:text-5xl"
            >
              Where we’re headed.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Read, ask, compare with a Related course and practise today. Next,
              we’re working on helping you notice what’s sticking and see ideas
              move instead of reading about them.
            </p>
            <ol className="relative mt-12">
              <li
                aria-labelledby="popquiz-title"
                className="relative border-l-2 border-primary pb-16 pl-8 sm:pl-12"
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-[9px] top-1 size-4 rounded-full border-2 border-primary bg-primary"
                />
                <span className="fieldnotes-kicker inline-block border border-primary-ink/30 bg-card px-2.5 py-1.5 text-primary-ink">
                  In development
                </span>
                <h3 id="popquiz-title" className="mt-4 text-lg font-semibold">
                  Pop quiz
                </h3>
                <div className="mt-6 grid items-center gap-8 rounded-sm border border-border bg-secondary/30 p-5 sm:p-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
                  <div>
                    <p className="max-w-sm font-editorial text-3xl leading-tight tracking-tight sm:text-4xl">
                      Small check-ins. A clearer next step.
                    </p>
                    <p className="mt-5 text-base leading-7 text-muted-foreground">
                      It can make sense while you’re reading. But what stays
                      with you? Pop quiz will offer short, skippable questions
                      at learning intervals, grounded in the Topic you’ve just
                      read.
                    </p>
                    <p className="mt-4 text-base leading-7 text-muted-foreground">
                      These check-ins will help track your understanding and
                      suggest what to revise, so you have a clearer idea of
                      where to spend your next study break.
                    </p>
                    <ul className="mt-6 space-y-3 border-l-2 border-primary pl-4 text-sm leading-6">
                      <li>Up to three questions. A pause, not a detour.</li>
                      <li>Notice the ideas that need another look.</li>
                      <li>Revisit with a suggestion.</li>
                    </ul>
                    <p className="mt-6 text-xs leading-6 text-muted-foreground">
                      In the pipeline, not yet available. This concept preview
                      shows the intended experience; the final design may
                      change.
                    </p>
                  </div>
                  <ProductIllustration kind="pop" title="Pop quiz" />
                </div>
              </li>
              <li
                aria-labelledby="visuals-title"
                className="relative border-l-2 border-primary pb-16 pl-8 sm:pl-12"
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-[9px] top-1 size-4 rounded-full border-2 border-primary bg-card"
                />
                <span className="fieldnotes-kicker inline-block border border-primary-ink/30 bg-card px-2.5 py-1.5 text-primary-ink">
                  Planned
                </span>
                <h3 id="visuals-title" className="mt-4 text-lg font-semibold">
                  Course-based interactive visuals
                </h3>
                <div className="mt-6 grid items-center gap-8 rounded-sm border border-border bg-secondary/30 p-5 sm:p-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
                  <div>
                    <p className="max-w-sm font-editorial text-3xl leading-tight tracking-tight sm:text-4xl">
                      Some ideas are easier to watch than to read.
                    </p>
                    <p className="mt-5 text-base leading-7 text-muted-foreground">
                      Interactive visuals built from your course’s Materials.
                      For CS3230, that could be an algorithm visualizer that
                      runs Ford–Fulkerson on a small network the way your
                      lecturer taught it, so you can pause, change a capacity
                      and see what happens.
                    </p>
                    <p className="mt-4 text-base leading-7 text-muted-foreground">
                      Which courses and Topics get visuals will depend on the
                      Materials and where they help most.
                    </p>
                    <ul className="mt-6 space-y-3 border-l-2 border-primary pl-4 text-sm leading-6">
                      <li>One step at a time, with the bottleneck shown.</li>
                      <li>Change the input and watch the answer move.</li>
                      <li>Grounded in your course’s worked examples.</li>
                    </ul>
                    <p className="mt-6 text-xs leading-6 text-muted-foreground">
                      Not yet available. This concept preview shows the intended
                      experience; the final design may change.{' '}
                      <a
                        href="https://visualgo.net"
                        target="_blank"
                        rel="noreferrer"
                        className="fieldnotes-action font-medium text-primary-ink underline"
                      >
                        Learn more
                        <span className="sr-only">
                          {' '}
                          about algorithm visualisation (opens VisuAlgo in a new
                          tab)
                        </span>
                      </a>
                    </p>
                  </div>
                  <ProductIllustration kind="flow" title="Max flow" />
                </div>
              </li>
              <li
                aria-labelledby="ahead-title"
                className="relative min-h-40 border-l-2 border-transparent pl-8 sm:pl-12"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -left-0.5 w-0.5 bg-linear-to-b from-primary to-transparent"
                />
                <span
                  aria-hidden="true"
                  className="absolute -left-[9px] top-1 size-4 rounded-full border-2 border-primary/50 bg-card"
                />
                <span className="fieldnotes-kicker inline-block border border-dashed border-primary-ink/30 bg-card px-2.5 py-1.5 text-primary-ink">
                  And after that
                </span>
                <h3 id="ahead-title" className="mt-4 text-lg font-semibold">
                  More features ahead
                </h3>
                <p className="mt-3 max-w-2xl font-editorial text-3xl leading-tight tracking-tight">
                  We grow with students, and build for students.
                </p>
                <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
                  What comes next is shaped by what you read, ask and practise
                  in the beta.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section
          aria-labelledby="faq-title"
          className="border-t border-border px-5 py-16 sm:px-10 lg:py-20"
        >
          <div className="mx-auto grid max-w-[1200px] gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <div>
              <p className="fieldnotes-kicker mb-4 text-primary-ink">
                A few useful answers
              </p>
              <h2
                id="faq-title"
                className="font-editorial text-4xl tracking-tight sm:text-5xl"
              >
                Before you settle in.
              </h2>
            </div>
            <div className="border-t border-border">
              {FAQS.map(([question, answer]) => (
                <details
                  key={question}
                  className="group border-b border-border"
                >
                  <summary className="cursor-pointer py-5 pr-3 text-base font-semibold marker:text-primary-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                    {question}
                  </summary>
                  <p className="pb-6 pr-4 text-sm leading-7 text-muted-foreground">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="ready-title"
          className="bg-[#0E2622] px-5 py-16 text-white sm:px-10 lg:py-20"
        >
          <div className="mx-auto flex max-w-[1200px] flex-col justify-between gap-8 md:flex-row md:items-center">
            <div>
              <p className="fieldnotes-kicker mb-4 text-[#5CD1BE]">
                Make yourself at home
              </p>
              <h2
                id="ready-title"
                className="font-editorial text-4xl tracking-tight sm:text-5xl"
              >
                Stay curious. Go a little deeper.
              </h2>
              <p className="mt-4 text-base leading-7 text-[#C9DAD6]">
                Join the Telegram group, get your Invite, and your course
                workspace is next.
              </p>
            </div>
            <div className="shrink-0">
              <BetaAction onDark />
              <p className="mt-4 text-sm text-[#C9DAD6]">
                Already joined?{' '}
                <Link
                  to="/login"
                  search={LOGIN}
                  className="fieldnotes-action inline-flex min-h-11 items-center font-semibold underline"
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
          <a
            href="#roadmap"
            className="fieldnotes-action inline-flex min-h-11 items-center"
          >
            Growing with the beta{' '}
            <span aria-hidden="true" className="ml-2">
              ↗
            </span>
          </a>
        </div>
      </footer>
    </div>
  )
}
