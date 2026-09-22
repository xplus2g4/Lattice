import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { COURSE_RE, recordRecentCourse } from '#/lib/course'

export const Route = createFileRoute('/courses/$course')({
  validateSearch: (search: Record<string, unknown>): { material?: string } => ({
    material:
      typeof search.material === 'string' &&
      search.material.toLowerCase().endsWith('.pdf')
        ? search.material
        : undefined,
  }),
  component: CourseLayout,
})

function CourseLayout() {
  const { course } = Route.useParams()
  const valid = COURSE_RE.test(course)
  useEffect(() => {
    if (valid) recordRecentCourse(course)
  }, [course, valid])
  if (!valid)
    return (
      <p className="p-8 text-sm text-destructive">
        {course} is not a course code. Codes match {COURSE_RE.source}.
      </p>
    )
  return <Outlet />
}
