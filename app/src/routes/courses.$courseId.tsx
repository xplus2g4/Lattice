import { Link, createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { AskPanel } from '#/components/lattice/ask-panel'
import { CourseGate } from '#/components/lattice/course-gate'
import { MaterialViewer } from '#/components/lattice/material-viewer'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { authed } from '#/components/lattice/require-auth'
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
  component: authed(CourseRoute),
})

function CourseRoute() {
  const { courseId } = Route.useParams()
  return (
    <CourseGate courseId={courseId}>
      <CourseWorkspace />
    </CourseGate>
  )
}

function CourseWorkspace() {
  const { courseId } = Route.useParams()
  const { material } = Route.useSearch()
  const user = useUser()
  const { markOpened } = useLibrary(user)
  const [mobileView, setMobileView] = useState<'material' | 'ask'>('material')

  useEffect(() => {
    setMobileView('material')
    if (material) markOpened(courseId, material)
  }, [courseId, material, markOpened])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background md:flex-row">
      <aside
        className={
          material
            ? 'hidden w-80 shrink-0 flex-col border-r border-border bg-sidebar lg:flex'
            : 'flex max-h-[45%] w-full shrink-0 flex-col border-b border-border bg-sidebar md:max-h-none md:w-80 md:border-b-0 md:border-r'
        }
      >
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {material && (
          <div className="flex items-center gap-1 border-b border-border p-1.5 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileView('material')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                mobileView === 'material'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Material
            </button>
            <button
              type="button"
              onClick={() => setMobileView('ask')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                mobileView === 'ask'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Ask
            </button>
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
        )}
        <div className="flex min-h-0 min-w-0 flex-1">
          {material && (
            <section
              className={`min-w-0 flex-1 flex-col lg:flex ${
                mobileView === 'material' ? 'flex' : 'hidden'
              }`}
            >
              <div className="hidden items-center gap-2 border-b border-border px-4 py-2 lg:flex">
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
                ? `min-h-0 min-w-0 flex-1 flex-col lg:flex lg:w-80 lg:flex-none lg:border-l lg:border-border xl:w-96 ${
                    mobileView === 'ask' ? 'flex' : 'hidden'
                  }`
                : 'flex min-h-0 min-w-0 flex-1 flex-col'
            }
          >
            <AskPanel course={courseId} user={user} />
          </div>
        </div>
      </main>
    </div>
  )
}
