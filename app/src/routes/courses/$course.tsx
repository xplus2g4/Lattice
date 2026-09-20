import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Brand, Icon, inputClass } from '#/components/common'
import {
  COURSE_RE,
  RECENT_COURSES_KEY,
  parseRecentCourses,
  recordRecentCourse,
} from '#/lib/course'
import { useStored, useUser } from '#/lib/storage'

export const Route = createFileRoute('/courses/$course')({
  component: CourseLayout,
})

function CourseLayout() {
  const { course } = Route.useParams()
  const [user, setUser] = useUser()
  const [recentsJson] = useStored(RECENT_COURSES_KEY, '[]')
  const [menuOpen, setMenuOpen] = useState(false)
  const courseOk = COURSE_RE.test(course)
  const courses = Array.from(
    new Set([course, ...parseRecentCourses(recentsJson)]),
  )

  useEffect(() => {
    if (courseOk) recordRecentCourse(course)
  }, [course, courseOk])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <Link to="/" aria-label="Lattice home">
          <Brand />
        </Link>
        <span className="header-divider" />
        <span className="header-caption">YOUR STUDY COMPANION</span>
        {courseOk && (
          <nav className="top-nav" aria-label="Workspace">
            <Link
              to="/courses/$course/dashboard"
              params={{ course }}
              activeProps={{ className: 'active' }}
            >
              Dashboard
            </Link>
            <Link
              to="/courses/$course/ask"
              params={{ course }}
              activeProps={{ className: 'active' }}
            >
              Study mode
            </Link>
            <Link
              to="/courses/$course/mastery"
              params={{ course }}
              activeProps={{ className: 'active' }}
            >
              Mastery hub
            </Link>
          </nav>
        )}
        <details className="identity-menu">
          <summary>
            <span className="avatar">
              {user.slice(0, 1).toUpperCase() || '?'}
            </span>
            <span>Local workspace</span>
            <span className="dev-badge">DEV</span>
          </summary>
          <div className="identity-popover">
            <label>
              User
              <input
                className={inputClass}
                type="email"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </label>
            <p className="muted">
              Development identity only. Sign-in and verified Enrolment are not
              connected yet.
            </p>
          </div>
        </details>
        <button
          type="button"
          className="icon-button mobile-menu"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          aria-controls="course-sidebar"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name="menu" />
        </button>
      </header>
      <aside
        id="course-sidebar"
        className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}
      >
        <p className="eyebrow">Your workspace</p>
        <Link to="/" className="sidebar-link">
          <Icon name="grid" />
          All courses
          <Icon name="arrow" size={15} />
        </Link>
        <div className="sidebar-section-heading">
          <p className="eyebrow">Recent courses</p>
          <Link to="/" aria-label="Open another course">
            <Icon name="plus" size={16} />
          </Link>
        </div>
        <nav aria-label="Courses" className="course-list">
          {courses
            .filter((c) => COURSE_RE.test(c))
            .map((c, i) => (
              <Link
                key={c}
                to="/courses/$course/dashboard"
                params={{ course: c }}
                className={`course-link ${c === course ? 'selected' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <span className={`course-dot course-dot-${i % 3}`} />
                <span className="course-code">{c}</span>
                {c === course && <span className="current-dot" />}
              </Link>
            ))}
        </nav>
        {courseOk && (
          <>
            <p className="eyebrow sidebar-section-heading">Study tools</p>
            <nav aria-label="Course tools" className="tools-nav">
              <Link
                to="/courses/$course/materials"
                params={{ course }}
                activeProps={{ className: 'active' }}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="book" />
                Materials
              </Link>
              <Link
                to="/courses/$course/notes"
                params={{ course }}
                activeProps={{ className: 'active' }}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="note" />
                Notes
                <Icon name="lock" size={13} />
              </Link>
              <Link
                to="/courses/$course/ask"
                params={{ course }}
                activeProps={{ className: 'active' }}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="spark" />
                Ask
              </Link>
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Icon name="spark" />
            <strong>A little clarity, every day.</strong>
            <p>Bring your questions. Build your understanding.</p>
          </div>
          <span className="privacy-caption">
            <Icon name="lock" size={13} />
            Notes stay in your private tier
          </span>
        </div>
      </aside>
      <main
        id="main-content"
        className="main-content"
        key={`${course}:${user}`}
      >
        {!courseOk ? (
          <div className="panel error-line">
            “{course}” is not a course code. Codes match {COURSE_RE.source}.
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
