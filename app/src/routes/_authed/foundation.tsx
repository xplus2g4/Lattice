import { createFileRoute } from '@tanstack/react-router'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Progress } from '#/components/ui/progress'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Textarea } from '#/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

export const Route = createFileRoute('/_authed/foundation')({
  component: FoundationPreview,
})

const coreColours = [
  ['Background', '--background'],
  ['Foreground', '--foreground'],
  ['Primary', '--primary'],
  ['Primary foreground', '--primary-foreground'],
  ['Secondary', '--secondary'],
  ['Secondary foreground', '--secondary-foreground'],
  ['Muted', '--muted'],
  ['Muted foreground', '--muted-foreground'],
  ['Accent', '--accent'],
  ['Accent foreground', '--accent-foreground'],
  ['Destructive', '--destructive'],
  ['Border / input', '--border'],
] as const

const semanticColours = [
  ['Canvas', '--lattice-canvas'],
  ['Surface', '--lattice-surface'],
  ['Primary text', '--lattice-text-primary'],
  ['Muted text', '--lattice-text-muted'],
  ['Primary action', '--lattice-primary-action'],
  ['Selected surface', '--lattice-selected-surface'],
  ['Citation context', '--lattice-citation-context'],
  ['Strong feedback', '--lattice-strong'],
  ['Developing feedback', '--lattice-developing'],
  ['Revisit feedback', '--lattice-revisit'],
] as const

const spacing = [
  ['1', '0.25rem', '--lattice-space-1'],
  ['2', '0.5rem', '--lattice-space-2'],
  ['3', '0.75rem', '--lattice-space-3'],
  ['4', '1rem', '--lattice-space-4'],
  ['6', '1.5rem', '--lattice-space-6'],
  ['8', '2rem', '--lattice-space-8'],
  ['12', '3rem', '--lattice-space-12'],
] as const

function FoundationPreview() {
  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 border-b border-border pb-8 sm:mb-14">
          <p className="text-lattice-meta font-semibold tracking-[0.18em] text-primary">
            LATTICE · DESIGN SYSTEM
          </p>
          <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-lattice-display font-semibold tracking-tight">
                Foundation
              </h1>
              <p className="mt-3 max-w-2xl text-lattice-prompt text-muted-foreground">
                A live reference for the colour, type, spacing, and interface
                tokens used across Lattice.
              </p>
            </div>
            <Badge variant="secondary">Light mode · Teal</Badge>
          </div>
        </header>

        <div className="space-y-14">
          <Section
            eyebrow="01 · Colour"
            title="Core palette"
            description="Base tokens used by components. Each swatch is rendered directly from its CSS variable."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {coreColours.map(([name, token]) => (
                <ColourSwatch key={token} name={name} token={token} />
              ))}
            </div>
          </Section>

          <Section
            eyebrow="02 · Semantic colour"
            title="Meaning over hue"
            description="Use these in product UI when the token describes the job the colour performs."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {semanticColours.map(([name, token]) => (
                <ColourSwatch key={token} name={name} token={token} compact />
              ))}
            </div>
          </Section>

          <Section
            eyebrow="03 · Typography"
            title="A clear reading hierarchy"
            description="Figtree is the active family; the scale balances focused reading and quiet metadata."
          >
            <Card className="gap-0 overflow-hidden py-0 shadow-none">
              <TypeRow
                token="text-lattice-display"
                label="Display"
                value="3rem / 48px"
              >
                Know your course, not just your notes.
              </TypeRow>
              <TypeRow
                token="text-lattice-heading"
                label="Heading"
                value="1.5rem / 24px"
              >
                Retrieval grounded in Material
              </TypeRow>
              <TypeRow
                token="text-lattice-prompt"
                label="Prompt"
                value="1.125rem / 18px"
              >
                What would you like to understand today?
              </TypeRow>
              <TypeRow
                token="text-lattice-body"
                label="Body"
                value="1rem / 16px"
              >
                Each answer brings the relevant ideas together, with citations
                that lead back to the original Material.
              </TypeRow>
              <TypeRow
                token="text-lattice-meta"
                label="Meta"
                value="0.75rem / 12px"
              >
                LECTURE 05 · SLIDES 12–14
              </TypeRow>
            </Card>
          </Section>

          <Section
            eyebrow="04 · Spacing & shape"
            title="Rhythm you can see"
            description="A compact spacing scale gives layouts consistent breathing room."
          >
            <Card className="grid gap-8 p-6 shadow-none lg:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-4">
                {spacing.map(([, value, token]) => (
                  <div
                    key={token}
                    className="grid grid-cols-[5rem_1fr] items-center gap-4"
                  >
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {token}
                      </p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                    <div
                      className="h-5 rounded-sm bg-primary"
                      style={{ width: `var(${token})` }}
                    />
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0">
                <p className="text-sm font-medium">Radius</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <RadiusSample className="rounded-sm" label="sm · 4px" />
                  <RadiusSample className="rounded-md" label="md · 6px" />
                  <RadiusSample className="rounded-lg" label="lg · 8px" />
                  <RadiusSample className="rounded-xl" label="xl · 12px" />
                </div>
              </div>
            </Card>
          </Section>

          <Section
            eyebrow="05 · Elevation"
            title="Soft depth"
            description="Shadows indicate hierarchy without competing with reading content."
          >
            <div className="grid gap-5 sm:grid-cols-3">
              <ShadowSample className="shadow-xs" label="shadow-xs" />
              <ShadowSample className="shadow-lg" label="shadow-lg" />
              <ShadowSample className="shadow-xl" label="shadow-xl" />
            </div>
          </Section>

          <Section
            eyebrow="06 · Components"
            title="Tokens in context"
            description="A small live specimen of the components learners will encounter most often."
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
              <Card className="p-6">
                <Tabs defaultValue="material">
                  <TabsList
                    variant="line"
                    className="gap-5 border-b border-border p-0"
                  >
                    <TabsTrigger
                      value="material"
                      className="rounded-none px-1 pb-3 data-active:text-primary after:bg-primary"
                    >
                      Material
                    </TabsTrigger>
                    <TabsTrigger
                      value="notes"
                      className="rounded-none px-1 pb-3 data-active:text-primary after:bg-primary"
                    >
                      Notes
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="mt-6 text-lattice-heading font-semibold">
                  Ask a focused question
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Answers cite the Material that supports them.
                </p>
                <Textarea
                  aria-label="Example study question"
                  className="mt-5 min-h-28 bg-background"
                  placeholder="How does retrieval augmentation work?"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button>Ask about this</Button>
                  <Button variant="outline">Save Note</Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost">Hint</Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Tooltips explain quiet actions.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Badges &amp; feedback</CardTitle>
                  <CardDescription>
                    Card, Badge, Progress, and Skeleton — the primitives every
                    screen composes.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap gap-2">
                    <Badge>Cognify complete</Badge>
                    <Badge variant="secondary">Week 5</Badge>
                    <Badge className="border-0 bg-citation-context text-citation-context-text">
                      Citation · Slides 12–14
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="border-0 bg-feedback-strong text-feedback-strong-text">
                      Strong
                    </Badge>
                    <Badge className="border-0 bg-feedback-developing text-feedback-developing-text">
                      Developing
                    </Badge>
                    <Badge className="border-0 bg-feedback-revisit text-feedback-revisit-text">
                      Revisit
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Cognify progress</p>
                    <Progress value={64} className="mt-2" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Loading state</p>
                    <div className="mt-2 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section
            eyebrow="07 · Dark mode"
            title="Same system, lower light"
            description="The teal system has a dark counterpart ready for a `.dark` ancestor."
          >
            <div className="dark rounded-xl border border-sidebar-border bg-sidebar p-6 text-sidebar-foreground">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-semibold tracking-[0.16em] text-primary">
                    DARK MODE
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    Calm contrast for late study sessions.
                  </p>
                </div>
                <Button>Ask a question</Button>
              </div>
              <div className="mt-6 grid grid-cols-5 gap-3">
                {(
                  [
                    '--background',
                    '--card',
                    '--primary',
                    '--secondary',
                    '--border',
                  ] as const
                ).map((token) => (
                  <div key={token}>
                    <div
                      className="h-12 rounded-lg border border-border"
                      style={{ backgroundColor: `var(${token})` }}
                    />
                    <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                      {token.replace('--', '')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </main>
  )
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-6">
        <p className="text-lattice-meta font-semibold tracking-[0.16em] text-primary">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-lattice-heading font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

function ColourSwatch({
  name,
  token,
  compact = false,
}: {
  name: string
  token: string
  compact?: boolean
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div
        className={compact ? 'h-16' : 'h-24'}
        style={{ backgroundColor: `var(${token})` }}
      />
      <div className="p-3">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {token}
        </p>
      </div>
    </Card>
  )
}

function TypeRow({
  token,
  label,
  value,
  children,
}: {
  token: string
  label: string
  value: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3 border-b border-border p-5 last:border-b-0 md:grid-cols-[10rem_1fr] md:items-baseline">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {token} · {value}
        </p>
      </div>
      <p className={`${token} font-medium tracking-tight`}>{children}</p>
    </div>
  )
}

function RadiusSample({
  className,
  label,
}: {
  className: string
  label: string
}) {
  return (
    <div>
      <div className={`h-16 border border-primary bg-secondary ${className}`} />
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        {label}
      </p>
    </div>
  )
}

function ShadowSample({
  className,
  label,
}: {
  className: string
  label: string
}) {
  return (
    <div className="rounded-xl bg-card p-6 text-center">
      <div
        className={`rounded-lg border border-border bg-background px-4 py-8 ${className}`}
      >
        <p className="font-mono text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
