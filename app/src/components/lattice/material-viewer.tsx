import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Button } from '#/components/ui/button'
import { downloadMaterial } from '#/lib/api'
import { useUser } from '#/lib/user'

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
      const blob = await downloadMaterial(user, course, filename)
      const kind = kindOf(filename)
      return { blob, kind, text: kind === 'text' ? await blob.text() : null }
    },
  })
  const url = useObjectUrl(file.data?.blob)
  return { file, url }
}

export function MaterialViewer({
  course,
  filename,
}: {
  course: string
  filename: string
}) {
  const { file, url } = useMaterialFile(course, filename)

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
      {file.data?.kind === 'pdf' && url && (
        <iframe src={url} title={filename} className="h-full w-full" />
      )}
      {file.data?.kind === 'text' && (
        <div className="mx-auto h-full max-w-3xl overflow-y-auto px-6 py-8">
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
  )
}
