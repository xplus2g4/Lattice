import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { inputClass } from '#/components/common'
import { COURSE_RE, recordRecentCourse } from '#/lib/course'
import { useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course')({
  component: CourseLayout,
})

const tabClass = 'text-sm underline underline-offset-4'
const activeTabClass = 'text-sm font-semibold underline underline-offset-4'

function CourseLayout() {
  const { course } = Route.useParams()
  const [user, setUser] = useUser()
  const courseOk = COURSE_RE.test(course)

  useEffect(() => {
    if (courseOk) recordRecentCourse(course)
  }, [course, courseOk])

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-2xl font-bold">
          <Link to="/">Course knowledge store</Link>
        </h1>
        <span className="font-mono text-sm">{course}</span>
        <label className="flex flex-col text-xs">
          User
          <input
            className={inputClass}
            type="email"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </label>
      </header>
      {!courseOk ? (
        <p className="text-sm text-red-700">
          “{course}” is not a course code. Codes match {COURSE_RE.source}.
        </p>
      ) : (
        <>
          <nav className="flex gap-4 border-b border-gray-200 pb-2">
            <Tab
              course={course}
              to="/courses/$course/materials"
              label="Materials"
            />
            <Tab course={course} to="/courses/$course/notes" label="Notes" />
            <Tab course={course} to="/courses/$course/ask" label="Ask" />
          </nav>
          <Outlet />
        </>
      )}
    </main>
  )
}

function Tab({
  course,
  to,
  label,
}: {
  course: string
  to:
    | '/courses/$course/materials'
    | '/courses/$course/notes'
    | '/courses/$course/ask'
  label: string
}) {
  return (
    <Link
      to={to}
      params={{ course }}
      className={tabClass}
      activeProps={{ className: activeTabClass }}
    >
      {label}
    </Link>
  )
}
