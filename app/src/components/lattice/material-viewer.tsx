import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'

import { Button } from '#/components/ui/button'
import { Markdown } from '#/components/lattice/answer'
import { downloadMaterial } from '#/lib/api'
import { installReadableStreamAsyncIterator } from '#/lib/readable-stream-async-iterator'
import { useUser } from '#/lib/user'

import type { QueryKey } from '@tanstack/react-query'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

installReadableStreamAsyncIterator()

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type Kind = 'pdf' | 'markdown' | 'text' | 'download'

function kindOf(filename: string): Kind {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.md') return 'markdown'
  if (ext === '.txt') return 'text'
  return 'download'
}

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
      setUrl(null)
    }
  }, [blob])
  return url
}

/** Where a viewer's bytes come from: a Material, or a PDF Note. */
export interface FileSource {
  queryKey: QueryKey
  filename: string
  load: () => Promise<Blob>
}

function useFile({ queryKey, filename, load }: FileSource) {
  const file = useQuery({
    queryKey,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const blob = await load()
      const kind = kindOf(filename)
      const readable = kind === 'text' || kind === 'markdown'
      return { blob, kind, text: readable ? await blob.text() : null }
    },
  })
  const url = useObjectUrl(file.data?.blob)
  return { file, url }
}

export interface PageRange {
  page?: number
  pageEnd?: number
  jump?: number
}

/** A tab's reading position: where to return when it reloads, and how to report moves. */
export interface ReadingPosition {
  resume?: number
  onPage?: (page: number) => void
}

function PdfPages({
  blob,
  page,
  pageEnd,
  jump,
  resume,
  onPage,
}: { blob: Blob } & PageRange & ReadingPosition) {
  const [numPages, setNumPages] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  const [rendered, setRendered] = useState<ReadonlySet<number>>(new Set())
  const scrolledTo = useRef<string | null>(null)
  // Used once, and only when nothing asked for a Page: a later Page request wins, and
  // losing that request (the tab going to the back) must not scroll anywhere.
  const [resumeAt, setResumeAt] = useState(page ? undefined : resume)
  const target = page && numPages ? Math.min(page, numPages) : undefined
  const last = target ? Math.max(pageEnd ?? target, target) : undefined
  const scrollTarget =
    target ?? (resumeAt && numPages ? Math.min(resumeAt, numPages) : undefined)

  // Pages above the target change height as they render, so wait for all of them.
  useEffect(() => {
    const visit = `${scrollTarget}:${jump}`
    if (!scrollTarget || scrolledTo.current === visit) return
    for (let p = 1; p <= scrollTarget; p++) if (!rendered.has(p)) return
    containerRef.current
      ?.querySelector(`[data-page-number="${scrollTarget}"]`)
      ?.scrollIntoView({ block: 'start' })
    scrolledTo.current = visit
    setResumeAt(undefined)
  }, [scrollTarget, jump, rendered])

  // Reports the Page filling the top half of the view, at most once a frame.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onPage) return
    let frame = 0
    let reported = 0
    const report = () => {
      frame = 0
      const middle = el.getBoundingClientRect().top + el.clientHeight / 2
      for (const p of el.querySelectorAll<HTMLElement>('[data-page-number]')) {
        if (p.getBoundingClientRect().bottom > middle) {
          const n = Number(p.dataset.pageNumber)
          if (n !== reported) {
            reported = n
            onPage(n)
          }
          return
        }
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [onPage])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Zero means hidden (display: none), not narrow: keep the last width rather than
    // redraw every Page at full size and lose the reader's place.
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      <Document
        file={blob}
        // react-pdf 11 suspends by default, and the nearest boundary is the route's, so
        // every PDF load hid the whole workspace. Its own loading and error states stay
        // inside the viewer instead. Pages inherit this from the Document.
        suspense={false}
        loading={
          <p className="p-6 text-sm text-muted-foreground">Rendering…</p>
        }
        error={
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-semibold">Could not render this PDF</p>
            <p className="text-sm text-muted-foreground">
              The material downloaded fine but the reader failed — try
              downloading it instead.
            </p>
          </div>
        }
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 py-6"
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={width ? Math.min(width - 32, 896) : undefined}
            onRenderSuccess={() =>
              setRendered((prev) =>
                prev.has(i + 1) ? prev : new Set(prev).add(i + 1),
              )
            }
            className={
              target && last && i + 1 >= target && i + 1 <= last
                ? 'shadow-lattice ring-2 ring-primary ring-offset-2 ring-offset-background'
                : 'shadow-lattice'
            }
          />
        ))}
      </Document>
    </div>
  )
}

export function MaterialViewer({
  course,
  filename,
  ...rest
}: {
  course: string
  filename: string
} & PageRange &
  ReadingPosition) {
  const user = useUser()
  return (
    <FileViewer
      source={{
        queryKey: ['material-file', course, filename, user],
        filename,
        load: () => downloadMaterial(course, filename),
      }}
      {...rest}
    />
  )
}

export function FileViewer({
  source,
  page,
  pageEnd,
  jump,
  resume,
  onPage,
}: { source: FileSource } & PageRange & ReadingPosition) {
  const { filename } = source
  const { file, url } = useFile(source)
  // react-pdf touches browser APIs; never render it during SSR.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="h-full min-h-0">
      {file.isPending && (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      )}
      {file.error && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-semibold">Could not load {filename}</p>
          <p className="text-sm text-destructive">{file.error.message}</p>
        </div>
      )}
      {file.data?.kind === 'pdf' &&
        (mounted ? (
          <PdfPages
            key={filename}
            blob={file.data.blob}
            page={page}
            pageEnd={pageEnd}
            jump={jump}
            resume={resume}
            onPage={onPage}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ))}
      {file.data?.kind === 'text' && (
        <div className="mx-auto h-full max-w-3xl overflow-y-auto px-6 py-8">
          <pre className="font-sans text-sm leading-7 whitespace-pre-wrap">
            {file.data.text}
          </pre>
        </div>
      )}
      {/* Rendered, as a Note's preview is; a Material has no editor to switch to. */}
      {file.data?.kind === 'markdown' && (
        <div className="mx-auto h-full max-w-3xl overflow-y-auto px-6 py-8">
          <Markdown>{file.data.text ?? ''}</Markdown>
        </div>
      )}
      {file.data?.kind === 'download' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-semibold">This material can't be previewed</p>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Download it to view. It is still searchable — cognified content
            feeds the course's answers.
          </p>
          <Button asChild disabled={!url}>
            <a href={url ?? '#'} download={filename}>
              Download {filename}
            </a>
          </Button>
        </div>
      )}
    </div>
  )
}
