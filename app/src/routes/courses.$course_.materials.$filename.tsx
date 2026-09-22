import { Link, createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { useEffect } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  MaterialViewer,
  useMaterialFile,
} from '#/components/lattice/material-viewer'
import { useLibrary } from '#/lib/library'

export const Route = createFileRoute('/courses/$course_/materials/$filename')({
  component: MaterialViewerRoute,
})

function MaterialViewerRoute() {
  const { course, filename } = Route.useParams()
  const { markOpened } = useLibrary()

  useEffect(() => {
    markOpened(course, filename)
  }, [course, filename, markOpened])

  const { url } = useMaterialFile(course, filename)

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          Homepage
        </Link>
        <Badge variant="secondary" className="font-mono uppercase">
          {course}
        </Badge>
        <p
          className="min-w-0 flex-1 basis-32 truncate text-sm font-medium"
          title={filename}
        >
          {filename}
        </p>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="min-h-11 rounded-lg"
          disabled={!url}
        >
          <a href={url ?? '#'} download={filename}>
            Download
          </a>
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        <MaterialViewer course={course} filename={filename} />
      </div>
    </div>
  )
}
