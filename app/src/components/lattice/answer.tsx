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

/** An answer's Markdown, with GFM and KaTeX math. Raw HTML is not rendered: answers
 * are built from retrieved text, which is untrusted. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:text-foreground prose-strong:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground">
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

export function ReferenceList({
  course,
  references,
}: {
  course: string
  references: References
}) {
  const { sources, concepts } = references
  if (sources.length === 0 && concepts.length === 0) return null
  return (
    <section className="mt-3 border-t border-border pt-3">
      {sources.length > 0 && (
        <>
          <p className="text-lattice-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            References
          </p>
          <ol className="mt-1.5 space-y-1.5">
            {sources.map((s, i) => (
              <li key={s.name} className="flex items-baseline gap-2 text-sm">
                <span className="w-4 shrink-0 text-right text-lattice-meta tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  {s.filename ? (
                    <Link
                      to="/courses/$course"
                      params={{ course }}
                      search={pageSearch(s.filename, s.spans.at(0))}
                      state={bumpJump}
                      // The viewer scrolls to the Page itself; router scroll restoration would undo it.
                      resetScroll={false}
                      className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {s.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate font-medium">
                      {s.label}
                    </span>
                  )}
                  {s.spans.map((span) =>
                    s.filename ? (
                      <Link
                        key={span.start}
                        to="/courses/$course"
                        params={{ course }}
                        search={pageSearch(s.filename, span)}
                        state={bumpJump}
                        resetScroll={false}
                        className="rounded-md bg-citation-context px-1.5 py-0.5 text-xs font-medium text-citation-context-text transition-opacity hover:opacity-80"
                        aria-label={`${s.label}, ${pages(span)}`}
                      >
                        {pages(span)}
                      </Link>
                    ) : (
                      <span
                        key={span.start}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
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
