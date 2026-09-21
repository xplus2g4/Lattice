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
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/courses/$course"
          params={{ course }}
          search={{ material: undefined }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          Workspace
        </Link>
        <Badge variant="secondary" className="font-mono uppercase">
          {course}
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
        <MaterialViewer course={course} filename={filename} />
      </div>
    </div>
  )
}
