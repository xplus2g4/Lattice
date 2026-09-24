import { createFileRoute, useLocation } from '@tanstack/react-router'

import { CourseWorkspace } from '#/components/lattice/course-workspace'

// The bare course URL opens the reader workspace: open tabs, with Ask beside them.
export const Route = createFileRoute('/_authed/courses/$course/')({
  component: Workspace,
})

function Workspace() {
  const { course } = Route.useParams()
  const { material, note, page, pageEnd } = Route.useSearch()
  const jump = useLocation({ select: (l) => l.state.jump })
  return (
    <CourseWorkspace
      course={course}
      material={material}
      note={note}
      page={page}
      pageEnd={pageEnd}
      jump={jump}
    />
  )
}
