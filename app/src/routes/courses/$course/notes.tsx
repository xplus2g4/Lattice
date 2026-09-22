import { createFileRoute } from '@tanstack/react-router'
import { NotesPanel } from '#/components/lattice/notes-panel'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$course/notes')({
  component: NotesPage,
})
function NotesPage() {
  const { course } = Route.useParams()
  const [user] = useUser()
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {course}
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Notes</h1>
      </header>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <NotesPanel key={`${course}:${user}`} course={course} user={user} />
      </div>
    </main>
  )
}
