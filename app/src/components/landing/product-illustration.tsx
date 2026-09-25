import { LogoMark } from '#/components/lattice/top-bar'
import { MaxFlowPreview } from './max-flow-preview'

export type IllustrationKind =
  'workspace' | 'ask' | 'notes' | 'grill' | 'related' | 'pop' | 'flow'

function MaterialPreview() {
  return (
    <div className="min-w-0 border-b border-border bg-muted/40 p-4 sm:border-r sm:border-b-0 sm:p-5">
      <p className="fieldnotes-kicker text-muted-foreground">Course Material</p>
      <div className="mt-4 border border-border bg-card px-4 py-5 shadow-sm">
        <p className="font-mono text-[10px] text-primary-ink">
          COMPUTER SYSTEMS / 04
        </p>
        <p className="mt-3 font-editorial text-2xl leading-tight">
          Why keep a cache?
        </p>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          A small, fast memory keeps frequently needed data close to the
          processor.
        </p>
        <div className="my-5 flex items-center gap-1.5 text-center font-mono text-[10px]">
          <span className="flex-1 border border-border px-1 py-3">CPU</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ↔
          </span>
          <span className="flex-1 border border-primary-ink/40 bg-secondary px-1 py-3 text-primary-ink">
            Cache
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ↔
          </span>
          <span className="flex-1 border border-border px-1 py-3">Memory</span>
        </div>
        <p className="border-l-2 border-primary bg-secondary/40 py-2 pl-3 text-xs leading-5">
          Temporal locality: recently used data is likely to be used again.
        </p>
        <p className="mt-5 text-right font-mono text-[10px] text-muted-foreground">
          Memory & caching · 12
        </p>
      </div>
    </div>
  )
}

function AnswerPreview() {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <p className="fieldnotes-kicker text-primary-ink">Ask</p>
      <p className="mt-4 rounded-sm bg-secondary px-3 py-3 text-sm font-medium leading-6">
        Why is a small cache useful if we already have memory?
      </p>
      <div className="mt-5 flex items-center gap-2 text-xs font-semibold">
        <LogoMark /> Lattice
      </div>
      <p className="mt-3 text-sm leading-6">
        A cache is faster to access. Keeping recently used data nearby lets the
        processor avoid slower memory accesses when that data is needed again.
      </p>
      <div className="mt-4 border-t border-border pt-3">
        <p className="fieldnotes-kicker text-muted-foreground">Citations</p>
        <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-sm border border-border bg-citation-context px-2.5 py-1.5 text-xs text-citation-context-text">
          <span>Memory & caching</span>
          <span className="font-mono">p. 12</span>
        </div>
      </div>
    </div>
  )
}

function NotePreview() {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="fieldnotes-kicker text-primary-ink">My Notes</p>
        <span className="rounded-sm border border-border px-2 py-1 text-[10px] text-muted-foreground">
          Private to you
        </span>
      </div>
      <p className="mt-5 font-editorial text-2xl">The desk analogy</p>
      <p className="mt-4 text-sm leading-7">
        Memory is the bookshelf. The cache is my desk: smaller, but the things
        I’m using are right there.
      </p>
      <p className="mt-4 text-sm leading-7">
        <span className="bg-secondary px-1">
          Recently used ≠ always needed.
        </span>{' '}
        A cache works because programs often reuse data.
      </p>
      <div className="mt-5 border-t border-border pt-4">
        <p className="fieldnotes-kicker text-muted-foreground">
          A question to come back to
        </p>
        <p className="mt-2 text-sm italic leading-6">
          What happens when the data I need isn’t on the desk?
        </p>
      </div>
    </div>
  )
}

function GrillPreview() {
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="fieldnotes-kicker text-primary-ink">
            Grill me / Review
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Memory & caching</p>
        </div>
        <span className="rounded-sm bg-secondary px-3 py-2 font-mono text-sm">
          2 / 3 correct
        </span>
      </div>
      <div className="mt-4 rounded-xl border border-border p-4 shadow-lattice">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="fieldnotes-kicker text-muted-foreground">
            Question 03
          </span>
          <span className="rounded-sm bg-feedback-revisit px-2 py-1 text-feedback-revisit-text">
            Incorrect
          </span>
        </div>
        <p className="mt-3 text-sm font-semibold leading-6">
          Does a larger cache always make a program faster?
        </p>
        <dl className="mt-4 space-y-3 text-sm leading-6">
          <div>
            <dt className="text-xs text-muted-foreground">Your answer</dt>
            <dd>Yes, because it can hold more data.</dd>
          </div>
          <div>
            <dt className="text-xs text-primary-ink">Answer</dt>
            <dd>
              Not always. It depends on how the program accesses data, as well
              as the cache’s access time.
            </dd>
          </div>
        </dl>
      </div>
      <p className="mt-4 rounded-sm border border-border bg-feedback-developing px-4 py-3 text-sm leading-6 text-feedback-developing-text">
        You’ve got the idea of locality. Take another look at the trade-off
        between cache size and access time.
      </p>
    </div>
  )
}

function PopQuizPreview() {
  return (
    <div className="bg-secondary/30 p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span>Read a Topic</span>
        <span aria-hidden="true">→</span>
        <span className="font-semibold text-primary-ink">Check in</span>
        <span aria-hidden="true">→</span>
        <span>Revisit</span>
      </div>
      <div className="rounded-sm border border-border bg-card p-4 shadow-lattice sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="fieldnotes-kicker text-primary-ink">
            A moment to check in
          </p>
          <span className="font-mono text-[10px] text-muted-foreground">
            01 / 03
          </span>
        </div>
        <p className="mt-3 font-editorial text-2xl">What stayed with you?</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Memory & caching · Up to 3 questions · Skippable
        </p>
        <p className="mt-5 text-sm font-semibold leading-6">
          Which example shows temporal locality?
        </p>
        <ul className="mt-3 space-y-2 text-xs leading-5">
          <li className="flex gap-3 rounded-sm border border-primary-ink/40 bg-secondary p-3">
            <span
              aria-hidden="true"
              className="mt-1 size-3 shrink-0 rounded-full border-[3px] border-primary-ink"
            />
            <span>
              Reading the same variable again in a loop.
              <span className="mt-1 block font-semibold text-primary-ink">
                Correct · Reusing recently accessed data.
              </span>
            </span>
          </li>
          <li className="flex gap-3 rounded-sm border border-border p-3 text-muted-foreground">
            <span
              aria-hidden="true"
              className="mt-1 size-3 shrink-0 rounded-full border border-muted-foreground"
            />
            <span>Reading the next item in an array.</span>
          </li>
        </ul>
      </div>
      <div className="relative mt-5 border-l-2 border-primary pl-4">
        <p className="fieldnotes-kicker text-muted-foreground">
          After your check-in / Example
        </p>
        <p className="mt-2 text-sm">
          <span className="font-semibold">2 of 3 answers correct.</span> One
          idea worth another look.
        </p>
        <div className="mt-3 rounded-sm border border-border bg-card p-4">
          <p className="fieldnotes-kicker text-primary-ink">
            Suggested revision
          </p>
          <p className="mt-2 text-sm font-semibold">
            Cache misses · Memory & caching
          </p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            Revisit what happens when the data isn’t in the cache, then try
            explaining the extra memory access.
          </p>
        </div>
      </div>
    </div>
  )
}

function RelatedCoursePreview() {
  return (
    <div className="grid sm:grid-cols-2">
      <div className="min-w-0 border-b border-border p-4 sm:border-r sm:border-b-0 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="fieldnotes-kicker text-primary-ink">Ask</p>
          <span className="font-mono text-[10px] text-muted-foreground">
            CS4223
          </span>
        </div>
        <p className="mt-4 rounded-sm bg-secondary px-3 py-3 text-sm font-medium leading-6">
          What is a cache coherence protocol?
        </p>
        <div className="mt-5 flex items-center gap-2 text-xs font-semibold">
          <LogoMark /> Lattice
        </div>
        <p className="mt-3 text-sm leading-6">
          A set of rules that keeps every core’s private cache agreeing on the
          value of a shared address. Snooping protocols such as MSI and MESI
          broadcast each write; directory protocols track sharers instead.
        </p>
        <div className="mt-4 border-t border-border pt-3">
          <p className="fieldnotes-kicker text-muted-foreground">Citations</p>
          <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-sm border border-border bg-citation-context px-2.5 py-1.5 text-xs text-citation-context-text">
            <span>Lecture 4 · Coherence</span>
            <span className="font-mono">p. 8</span>
          </div>
        </div>
      </div>
      <div className="min-w-0 bg-muted/40 p-4 sm:p-5">
        <div className="border-l-2 border-primary-ink/40 bg-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Related course · CS3210
          </p>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6">
            <li>
              Each core reads a shared address through its own cache, so a write
              in one cache has to invalidate or update the copies in the others.
            </li>
            <li>
              False sharing: two threads writing different words on the same
              line bounce it between cores even though they never touch the same
              data.
            </li>
          </ul>
          <div className="mt-3 border-t border-border pt-3">
            <p className="fieldnotes-kicker text-muted-foreground">Citations</p>
            <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-sm border border-border bg-citation-context px-2.5 py-1.5 text-xs text-citation-context-text">
              <span>Week 5 · Shared memory</span>
              <span className="font-mono">p. 12</span>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Reference material from the course whose Materials sit nearest to
          yours, kept apart under its own code. Your Session stays in CS4223.
        </p>
      </div>
    </div>
  )
}

export function ProductIllustration({
  kind,
  title,
}: {
  kind: IllustrationKind
  title: string
}) {
  return (
    <figure
      aria-label={`${title} illustration`}
      className="min-w-0 overflow-hidden rounded-sm border border-border bg-card text-card-foreground shadow-lattice"
    >
      <div className="flex flex-wrap items-start border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-medium">
          <LogoMark />
          {title}
        </span>
      </div>
      {kind === 'flow' ? (
        <MaxFlowPreview />
      ) : kind === 'pop' ? (
        <PopQuizPreview />
      ) : kind === 'related' ? (
        <RelatedCoursePreview />
      ) : kind === 'grill' ? (
        <GrillPreview />
      ) : (
        <div className="grid sm:grid-cols-2">
          <MaterialPreview />
          {kind === 'notes' ? <NotePreview /> : <AnswerPreview />}
        </div>
      )}
    </figure>
  )
}
