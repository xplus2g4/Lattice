import { Link } from '@tanstack/react-router'
import type { HistoryState } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { describePages } from '#/lib/api'
import { normalizeMath } from '#/lib/markdown'

import type { Components } from 'react-markdown'
import type { PageSpan, References } from '#/lib/references'

const components: Components = {
  a: ({ node: _, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  table: ({ node: _, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
}

/** Markdown with GFM and KaTeX math: answers, Notes and `.md` Materials. Raw HTML is
 * not rendered: all three are untrusted text. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words leading-7 text-foreground dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-a:text-primary prose-a:decoration-primary/40 prose-strong:text-foreground prose-blockquote:border-primary prose-blockquote:font-normal prose-blockquote:text-muted-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-sm prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  )
}

function pages(span: PageSpan): string {
  return describePages({ page_start: span.start, page_end: span.end })
}

const bumpJump = (prev: HistoryState) => ({
  ...prev,
  jump: (prev.jump ?? 0) + 1,
})

function pageSearch(material: string, span: PageSpan | undefined) {
  return {
    material,
    page: span?.start,
    pageEnd: span && span.end > span.start ? span.end : undefined,
  }
}

/** The same reader location as `pageSearch`, as a plain href for a new-tab link. */
function readerHref(
  course: string,
  material: string,
  span: PageSpan | undefined,
): string {
  const search = new URLSearchParams({ material })
  const { page, pageEnd } = pageSearch(material, span)
  if (page) search.set('page', String(page))
  if (pageEnd) search.set('pageEnd', String(pageEnd))
  return `/courses/${encodeURIComponent(course)}?${search}`
}

/** A link into a course's reader: in place, or in a new tab when the reader belongs to
 * another course, so the student's own workspace stays where it is. */
function ReaderLink({
  course,
  material,
  span,
  newTab,
  className,
  label,
  children,
}: {
  course: string
  material: string
  span: PageSpan | undefined
  newTab: boolean
  className: string
  label?: string
  children: React.ReactNode
}) {
  if (newTab) {
    return (
      <a
        href={readerHref(course, material, span)}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        aria-label={label}
      >
        {children}
      </a>
    )
  }
  return (
    <Link
      to="/courses/$course"
      params={{ course }}
      search={pageSearch(material, span)}
      state={bumpJump}
      // The viewer scrolls to the Page itself; router scroll restoration would undo it.
      resetScroll={false}
      className={className}
      aria-label={label}
    >
      {children}
    </Link>
  )
}

export function ReferenceList({
  course,
  references,
  newTab = false,
}: {
  course: string
  references: References
  /** Open each reference in a new tab; for another course's Materials. */
  newTab?: boolean
}) {
  const { sources, concepts } = references
  if (sources.length === 0 && concepts.length === 0) return null
  return (
    <section className="mt-3 border-t border-border pt-3">
      {sources.length > 0 && (
        <>
          <p className="fieldnotes-kicker text-muted-foreground">Citations</p>
          <ol className="mt-1.5 space-y-1.5">
            {sources.map((s, i) => (
              <li key={s.name} className="flex items-baseline gap-2 text-sm">
                <span className="w-4 shrink-0 text-right text-lattice-meta tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  {s.filename ? (
                    <ReaderLink
                      course={course}
                      material={s.filename}
                      span={s.spans.at(0)}
                      newTab={newTab}
                      className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {s.label}
                    </ReaderLink>
                  ) : (
                    <span className="min-w-0 truncate font-medium">
                      {s.label}
                    </span>
                  )}
                  {s.spans.map((span) =>
                    s.filename ? (
                      <ReaderLink
                        key={span.start}
                        course={course}
                        material={s.filename}
                        span={span}
                        newTab={newTab}
                        className="inline-flex min-h-8 items-center rounded-xs [@media(pointer:coarse)]:min-h-11 border border-border bg-citation-context px-2 py-1 font-mono text-xs text-citation-context-text transition-colors hover:border-primary"
                        label={`${s.label}, ${pages(span)}`}
                      >
                        {pages(span)}
                      </ReaderLink>
                    ) : (
                      <span
                        key={span.start}
                        className="rounded-xs border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                      >
                        {pages(span)}
                      </span>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {concepts.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium">Related concepts:</span>{' '}
          {concepts.join(' · ')}
        </p>
      )}
    </section>
  )
}
