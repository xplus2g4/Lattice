import { createFileRoute } from '@tanstack/react-router'

import { Materials } from '#/components/materials'
import { useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course/materials')({
  component: MaterialsSection,
})

function MaterialsSection() {
  const { course } = Route.useParams()
  const [user] = useUser()
  return <Materials course={course} user={user} />
}
