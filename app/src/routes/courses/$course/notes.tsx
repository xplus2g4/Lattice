import { createFileRoute } from '@tanstack/react-router'

import { Notes } from '#/components/notes'
import { useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course/notes')({
  component: NotesSection,
})

function NotesSection() {
  const { course } = Route.useParams()
  const [user] = useUser()
  return <Notes course={course} user={user} />
}
