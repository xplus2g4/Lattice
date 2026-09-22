import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'

import { Button } from '#/components/ui/button'
import {
  downloadReaderMaterial,
  getReaderMaterial,
  getReadingPosition,
  saveReadingPosition,
} from '#/lib/api'
import { useUser } from '#/lib/user'
import { PageNoteEditor } from './page-note-editor'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type Kind = 'pdf' | 'text' | 'download'

function kindOf(filename: string): Kind {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.md' || ext === '.txt') return 'text'
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

export function useMaterialFile(course: string, filename: string) {
  const [user] = useUser()
  const file = useQuery({
    queryKey: ['material-file', course, filename, user],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const material = await getReaderMaterial(user, course, filename)
      const blob = await downloadReaderMaterial(user, course, material)
      const kind = kindOf(filename)
      return {
        blob,
        kind,
        material,
        text: kind === 'text' ? await blob.text() : null,
      }
    },
  })
  const url = useObjectUrl(file.data?.blob)
  return { file, url }
}

function Reader({
  blob,
  text,
  user,
  course,
  material,
}: {
  blob: Blob
  text: string | null
  user: string
  course: string
  material: string
}) {
  const client = useQueryClient()
  const [numPages, setNumPages] = useState(text === null ? 0 : 1)
  const [selectedPage, setSelectedPage] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  const position = useQuery({
    queryKey: ['reading-position', user, material],
    queryFn: () => getReadingPosition(user, material),
    retry: false,
    staleTime: Infinity,
  })
  const page = Math.max(
    1,
    Math.min(selectedPage ?? position.data ?? 1, numPages || 1),
  )
  const savePosition = useMutation({
    scope: { id: JSON.stringify(['reading-position', user, material]) },
    mutationFn: (next: number) => saveReadingPosition(user, material, next),
    onSuccess: (_, next) =>
      client.setQueryData(['reading-position', user, material], next),
  })
  function navigate(next: number) {
    setSelectedPage(next)
    savePosition.mutate(next)
    containerRef.current?.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!position.isSuccess || page <= 1}
          onClick={() => navigate(page - 1)}
        >
          Previous page
        </Button>
        <span aria-live="polite" className="text-sm tabular-nums">
          {numPages ? `Page ${page} of ${numPages}` : 'Loading pages…'}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!position.isSuccess || page >= numPages}
          onClick={() => navigate(page + 1)}
        >
          Next page
        </Button>
      </div>
      {savePosition.isError && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          Could not save your reading position.{' '}
          <Button
            size="xs"
            variant="outline"
            onClick={() => savePosition.mutate(page)}
          >
            Retry position save
          </Button>
        </p>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto">
        {position.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">
            Restoring your reading position…
          </p>
        ) : position.isError ? (
          <div role="alert" className="p-6 text-sm text-destructive">
            Could not restore your reading position.{' '}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void position.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : text !== null ? (
          <pre className="mx-auto max-w-3xl px-6 py-8 font-sans text-sm leading-7 whitespace-pre-wrap">
            {text}
          </pre>
        ) : (
          <Document
            file={blob}
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
            {numPages > 0 && (
              <Page
                key={page}
                pageNumber={page}
                width={
                  width ? Math.max(1, Math.min(width - 32, 896)) : undefined
                }
                className="shadow-lattice"
              />
            )}
          </Document>
        )}
      </div>
      {position.isSuccess && numPages > 0 && (
        <PageNoteEditor
          key={page}
          user={user}
          course={course}
          material={material}
          page={page}
        />
      )}
    </div>
  )
}

export function MaterialViewer({
  course,
  filename,
}: {
  course: string
  filename: string
}) {
  const [user] = useUser()
  const { file, url } = useMaterialFile(course, filename)
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
          <p className="font-semibold">Could not load this material</p>
          <p className="text-sm text-destructive">{file.error.message}</p>
        </div>
      )}
      {(file.data?.kind === 'pdf' || file.data?.kind === 'text') &&
        (mounted ? (
          <Reader
            key={JSON.stringify([user, file.data.material.id])}
            blob={file.data.blob}
            text={file.data.text}
            user={user}
            course={course}
            material={file.data.material.id}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ))}
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
