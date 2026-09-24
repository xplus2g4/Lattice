import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'

import { Button } from '#/components/ui/button'
import { downloadMaterial } from '#/lib/api'
import { useUser } from '#/lib/user'

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
  const user = useUser()
  const file = useQuery({
    queryKey: ['material-file', course, filename, user],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const blob = await downloadMaterial(user, course, filename)
      const kind = kindOf(filename)
      return { blob, kind, text: kind === 'text' ? await blob.text() : null }
    },
  })
  const url = useObjectUrl(file.data?.blob)
  return { file, url }
}

function PdfPages({ blob }: { blob: Blob }) {
  const [numPages, setNumPages] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()

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
    <div ref={containerRef} className="h-full overflow-y-auto">
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
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={width ? Math.min(width - 32, 896) : undefined}
            className="shadow-lattice"
          />
        ))}
      </Document>
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
      {file.data?.kind === 'pdf' &&
        (mounted ? (
          <PdfPages blob={file.data.blob} />
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
