import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { COURSE_RE, RECENT_COURSES_KEY, parseRecentCourses } from '#/lib/course'
import { useStored } from '#/lib/storage'
import { buttonClass, inputClass } from '#/components/common'

export const Route = createFileRoute('/')({ component: CoursePicker })

function CoursePicker() {
  const navigate = useNavigate()
  const [course, setCourse] = useState('')
  const [recentsJson] = useStored(RECENT_COURSES_KEY, '[]')
  const recents = parseRecentCourses(recentsJson)
  const courseOk = COURSE_RE.test(course)

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <h1 className="text-2xl font-bold">Course knowledge store</h1>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (courseOk) {
            void navigate({ to: '/courses/$course', params: { course } })
          }
        }}
      >
        <label className="flex flex-col text-xs">
          Course
          <input
            className={inputClass}
            value={course}
            placeholder="cs101"
            onChange={(e) => setCourse(e.target.value)}
          />
        </label>
        <button className={buttonClass} type="submit" disabled={!courseOk}>
          Open
        </button>
      </form>
      {course !== '' && !courseOk && (
        <p className="text-sm text-red-700">
          Course code must match {COURSE_RE.source}
        </p>
      )}
      {recents.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Recent courses</h2>
          <ul className="space-y-1">
            {recents.map((c) => (
              <li key={c}>
                <Link
                  className="text-sm text-blue-700 underline"
                  to="/courses/$course"
                  params={{ course: c }}
                >
                  {c}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
