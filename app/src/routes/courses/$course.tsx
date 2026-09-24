import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { COURSE_RE, recordRecentCourse } from '#/lib/course'

export const Route = createFileRoute('/courses/$course')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { material?: string; page?: number; pageEnd?: number } => {
    const material =
      typeof search.material === 'string' &&
      search.material.toLowerCase().endsWith('.pdf')
        ? search.material
        : undefined
    const page = material ? pageNumber(search.page) : undefined
    const pageEnd = page ? pageNumber(search.pageEnd) : undefined
    return {
      material,
      page,
      pageEnd: page && pageEnd && pageEnd > page ? pageEnd : undefined,
    }
  },
  component: CourseLayout,
})

function pageNumber(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function CourseLayout() {
  const { course } = Route.useParams()
  const courseOk = COURSE_RE.test(course)

  useEffect(() => {
    if (courseOk) recordRecentCourse(course)
  }, [course, courseOk])

  if (!courseOk) {
    return (
      <main className="mx-auto max-w-3xl space-y-8 p-8">
        <p className="text-sm text-red-700">
          “{course}” is not a course code. Codes match {COURSE_RE.source}.
        </p>
      </main>
    )
  }

  return <Outlet />
}
