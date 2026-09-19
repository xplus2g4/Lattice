import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { Ask } from '#/components/ask'
import { Materials } from '#/components/materials'
import { Notes } from '#/components/notes'
import { inputClass } from '#/components/common'
import { COURSE_RE, recordRecentCourse } from '#/lib/course'
import { useStored } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course')({
  component: CoursePage,
})

function CoursePage() {
  const { course } = Route.useParams()
  const [user, setUser] = useStored('lattice.user', 'alice@example.com')
  const courseOk = COURSE_RE.test(course)
  const ready = courseOk && user.trim() !== ''

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
      {!courseOk && (
        <p className="text-sm text-red-700">
          Course code must match {COURSE_RE.source}
        </p>
      )}
      {ready && (
        <>
          <Materials course={course} user={user} />
          <Notes course={course} user={user} />
          <Ask course={course} user={user} />
        </>
      )}
    </main>
  )
}
