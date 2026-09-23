import { createFileRoute, useLocation } from '@tanstack/react-router'

import { CourseWorkspace } from '#/components/lattice/course-workspace'

// The bare course URL opens the reader workspace with Ask beside the Material.
export const Route = createFileRoute('/courses/$course/')({
  component: Workspace,
})

function Workspace() {
  const { course } = Route.useParams()
  const { material, page, pageEnd } = Route.useSearch()
  const jump = useLocation({ select: (l) => l.state.jump })
  return (
    <CourseWorkspace
      course={course}
      material={material}
      page={page}
      pageEnd={pageEnd}
      jump={jump}
    />
  )
}
