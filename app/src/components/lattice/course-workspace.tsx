import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useState } from 'react'

import { Button } from '#/components/ui/button'
import { AskPanel } from '#/components/lattice/ask-panel'
import { MaterialViewer } from '#/components/lattice/material-viewer'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { useLibrary } from '#/lib/library'
import { useUser } from '#/lib/user'

export function CourseWorkspace({
  course,
  material,
}: {
  course: string
  material?: string
}) {
  const [user] = useUser()
  const { markOpened } = useLibrary()
  const [workspaceView, setWorkspaceView] = useState<'material' | 'ask'>(
    'material',
  )

  useEffect(() => {
    setWorkspaceView('material')
    if (material) markOpened(course, material)
  }, [course, material, markOpened])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background md:flex-row">
      <aside
        className={
          material
            ? 'hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex'
            : 'flex max-h-[45%] w-full shrink-0 flex-col border-b border-border bg-sidebar md:max-h-none md:w-80 md:border-b-0 md:border-r'
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MaterialsPanel course={course} user={user} />
          <NotesPanel course={course} user={user} />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {material && (
          <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-xs font-medium text-muted-foreground">
                {course.toUpperCase()} · Course reader
              </p>
              <h1 className="truncate text-sm font-semibold" title={material}>
                {material}
              </h1>
            </div>
            <div
              role="group"
              aria-label="Reader view"
              className="flex rounded-xl bg-muted p-1"
            >
              <button
                type="button"
                onClick={() => setWorkspaceView('material')}
                aria-pressed={workspaceView === 'material'}
                aria-controls="workspace-reader"
                className={`min-h-11 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                  workspaceView === 'material'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Reader
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView('ask')}
                aria-pressed={workspaceView === 'ask'}
                aria-controls="workspace-ask"
                className={`min-h-11 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                  workspaceView === 'ask'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Ask
              </button>
            </div>
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-11 rounded-lg"
            >
              <Link
                to="/courses/$course"
                params={{ course }}
                search={{ material: undefined }}
                aria-label="Close material"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
              </Link>
            </Button>
          </header>
        )}
        <div className="flex min-h-0 min-w-0 flex-1">
          {material && (
            <section
              id="workspace-reader"
              aria-label="Material and Page Notes"
              className={`min-w-0 flex-1 flex-col ${
                workspaceView === 'material' ? 'flex' : 'hidden'
              }`}
            >
              <div className="min-h-0 flex-1">
                <MaterialViewer course={course} filename={material} />
              </div>
            </section>
          )}
          <div
            id="workspace-ask"
            className={
              material
                ? `min-h-0 min-w-0 flex-1 flex-col ${
                    workspaceView === 'ask' ? 'flex' : 'hidden'
                  }`
                : 'flex min-h-0 min-w-0 flex-1 flex-col'
            }
          >
            <AskPanel course={course} user={user} />
          </div>
        </div>
      </main>
    </div>
  )
}
