import { Link, createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { useEffect } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { AskPanel } from '#/components/lattice/ask-panel'
import { MaterialViewer } from '#/components/lattice/material-viewer'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { useLibrary } from '#/lib/library'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$courseId')({
  validateSearch: (search: Record<string, unknown>) => ({
    material:
      typeof search.material === 'string' &&
      search.material.toLowerCase().endsWith('.pdf')
        ? search.material
        : undefined,
  }),
  component: CourseWorkspace,
})

function CourseWorkspace() {
  const { courseId } = Route.useParams()
  const { material } = Route.useSearch()
  const [user] = useUser()
  const { markOpened } = useLibrary()

  useEffect(() => {
    if (material) markOpened(courseId, material)
  }, [courseId, material, markOpened])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background md:flex-row">
      <aside className="flex max-h-[45%] w-full shrink-0 flex-col border-b border-border bg-sidebar md:max-h-none md:w-80 md:border-b-0 md:border-r">
        <div className="space-y-2 border-b border-border p-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
            Home
          </Link>
          <div className="px-1">
            <Badge variant="secondary" className="font-mono uppercase">
              {courseId}
            </Badge>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MaterialsPanel course={courseId} user={user} />
          <NotesPanel course={courseId} user={user} />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1">
        {material && (
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {material}
              </p>
              <Button asChild variant="ghost" size="icon-xs">
                <Link
                  to="/courses/$courseId"
                  params={{ courseId }}
                  search={{ material: undefined }}
                  aria-label="Close material"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
                </Link>
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <MaterialViewer course={courseId} filename={material} />
            </div>
          </section>
        )}
        <div
          className={
            material
              ? 'hidden min-h-0 w-96 shrink-0 flex-col border-l border-border md:flex'
              : 'flex min-h-0 min-w-0 flex-1 flex-col'
          }
        >
          <AskPanel course={courseId} user={user} />
        </div>
      </main>
    </div>
  )
}
