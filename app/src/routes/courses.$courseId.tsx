import { Link, createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { AskPanel } from '#/components/lattice/ask-panel'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$courseId')({
  component: CourseWorkspace,
})

function CourseWorkspace() {
  const { courseId } = Route.useParams()
  const [user] = useUser()

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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AskPanel course={courseId} user={user} />
      </main>
    </div>
  )
}
