import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { COURSE_RE, recordRecentCourse } from '#/lib/course'

export const Route = createFileRoute('/_authed/courses/$course')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    material?: string
    note?: string
    page?: number
    pageEnd?: number
  } => {
    // The tab in front: any Material, or else a Note (a draft has a client-made id).
    // Only a PDF Material has Pages to jump to.
    const material =
      typeof search.material === 'string' && search.material
        ? search.material
        : undefined
    const note =
      !material &&
      typeof search.note === 'string' &&
      /^[A-Za-z0-9_-]{1,64}$/.test(search.note)
        ? search.note
        : undefined
    const page = material?.toLowerCase().endsWith('.pdf')
      ? pageNumber(search.page)
      : undefined
    const pageEnd = page ? pageNumber(search.pageEnd) : undefined
    return {
      material,
      note,
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
