import { createFileRoute } from '@tanstack/react-router'
import { MaterialsPanel } from '#/components/lattice/materials-panel'
import { useUser } from '#/lib/user'

export const Route = createFileRoute('/courses/$course/materials')({
  component: MaterialsPage,
})
function MaterialsPage() {
  const { course } = Route.useParams()
  const [user] = useUser()
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {course}
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Materials</h1>
      </header>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <MaterialsPanel key={`${course}:${user}`} course={course} user={user} />
      </div>
    </main>
  )
}
