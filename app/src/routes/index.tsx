import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { COURSE_RE, RECENT_COURSES_KEY, parseRecentCourses } from '#/lib/course'
import { useStored } from '#/lib/storage'
import { Brand, Icon, buttonClass, inputClass } from '#/components/common'

export const Route = createFileRoute('/')({ component: CoursePicker })

function CoursePicker() {
  const navigate = useNavigate()
  const [course, setCourse] = useState('')
  const [recentsJson] = useStored(RECENT_COURSES_KEY, '[]')
  const recents = parseRecentCourses(recentsJson)
  const courseOk = COURSE_RE.test(course)

  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <Brand />
        <span className="muted">A little clarity, every day.</span>
        <span className="tag">STUDY WORKSPACE</span>
      </header>
      <main className="welcome-content">
        <section className="welcome-intro">
          <p className="eyebrow">LESS SEARCHING. MORE UNDERSTANDING.</p>
          <h1>
            Everything you learn.
            <br />
            <span>Starting to connect.</span>
          </h1>
          <p>
            Your course Materials, your own Notes, and a space to ask better
            questions. Welcome to Lattice.
          </p>
          <div className="welcome-benefits">
            <span>
              <Icon name="book" />
              Grounded in your course
            </span>
            <span>
              <Icon name="lock" />
              Your Notes, kept private
            </span>
          </div>
        </section>
        <section className="panel course-picker">
          <span className="empty-icon">
            <Icon name="grid" size={25} />
          </span>
          <h2>Find your learning space</h2>
          <p className="muted">
            Open a course to make a little more sense of it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (courseOk)
                void navigate({
                  to: '/courses/$course/dashboard',
                  params: { course },
                })
            }}
          >
            <label htmlFor="course-code">Course code</label>
            <input
              id="course-code"
              className={inputClass}
              value={course}
              placeholder="e.g. cs101"
              maxLength={16}
              autoComplete="off"
              aria-describedby="course-hint"
              aria-invalid={course !== '' && !courseOk}
              onChange={(e) => setCourse(e.target.value.toLowerCase().trim())}
            />
            <p id="course-hint" className="muted small">
              2–16 letters or numbers, starting with a letter.
            </p>
            <button
              className={`${buttonClass} full-width`}
              type="submit"
              disabled={!courseOk}
            >
              Open course
              <Icon name="arrow" size={16} />
            </button>
          </form>
          {course !== '' && !courseOk && (
            <p className="error-line">
              Course code must match {COURSE_RE.source}
            </p>
          )}
          {recents.length > 0 && (
            <section className="recent-courses">
              <p className="eyebrow">Recent courses</p>
              <div>
                {recents.map((c) => (
                  <Link
                    key={c}
                    className="recent-course"
                    to="/courses/$course/dashboard"
                    params={{ course: c }}
                  >
                    <Icon name="book" size={15} />
                    {c.toUpperCase()}
                    <Icon name="arrow" size={14} />
                  </Link>
                ))}
              </div>
            </section>
          )}
          <p className="picker-disclaimer">
            Local development workspace. Opening a course is not verified
            Enrolment.
          </p>
        </section>
      </main>
      <footer className="welcome-footer">
        Built around your curiosity. Grounded in your knowledge.
      </footer>
    </div>
  )
}
