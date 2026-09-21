import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { downloadMaterial } from '#/lib/api'
import { useLibrary } from '#/lib/library'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$courseId_/materials/$filename')(
  {
    component: MaterialViewer,
  },
)

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

function MaterialViewer() {
  const { courseId, filename } = Route.useParams()
  const [user] = useUser()
  const { markOpened } = useLibrary()

  useEffect(() => {
    markOpened(courseId, filename)
  }, [courseId, filename, markOpened])

  const file = useQuery({
    queryKey: ['material-file', courseId, filename, user],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const blob = await downloadMaterial(user, courseId, filename)
      const kind = kindOf(filename)
      return { blob, kind, text: kind === 'text' ? await blob.text() : null }
    },
  })
  const url = useObjectUrl(file.data?.blob)

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/courses/$courseId"
          params={{ courseId }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          Workspace
        </Link>
        <Badge variant="secondary" className="font-mono uppercase">
          {courseId}
        </Badge>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {filename}
        </p>
        <Button asChild variant="outline" size="sm" disabled={!url}>
          <a href={url ?? '#'} download={filename}>
            Download
          </a>
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {file.isPending && (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        )}
        {file.error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-semibold">Could not load this material</p>
            <p className="text-sm text-destructive">{file.error.message}</p>
          </div>
        )}
        {file.data?.kind === 'pdf' && url && (
          <iframe src={url} title={filename} className="h-full w-full" />
        )}
        {file.data?.kind === 'text' && (
          <div className="mx-auto max-w-3xl overflow-y-auto px-6 py-8">
            <pre className="font-sans text-sm leading-7 whitespace-pre-wrap">
              {file.data.text}
            </pre>
          </div>
        )}
        {file.data?.kind === 'download' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-semibold">This file type can't be previewed</p>
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
    </div>
  )
}
