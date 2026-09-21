import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CourseCard } from '#/components/lattice/course-card'
import { ApiError, listCourses } from '#/lib/api'
import { useLibrary } from '#/lib/library'
import { useUser } from '#/lib/user'

import type { CourseSummary } from '#/lib/api'

export const Route = createFileRoute('/')({ component: Home })

const COURSE_RE = /^[a-z][a-z0-9]{1,15}$/

const inputClass =
  'rounded-lg border border-border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring'

function Home() {
  const [user, setUser] = useUser()
  const { courses: added, lastOpened } = useLibrary()
  const courses = useQuery({
    queryKey: ['courses', user],
    queryFn: () => listCourses(user),
    retry: false,
  })

  // Server-known courses plus codes the user added but has not filled yet.
  const known = new Set((courses.data ?? []).map((c) => c.code))
  const merged: Array<CourseSummary> = [
    ...(courses.data ?? []),
    ...added
      .filter((code) => !known.has(code))
      .map((code) => ({
        code,
        material_count: 0,
        note_count: 0,
        pending_count: 0,
      })),
  ]

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-10 sm:py-14">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-lattice-meta font-semibold tracking-[0.18em] text-primary">
              LATTICE
            </p>
            <h1 className="mt-3 text-lattice-display font-semibold tracking-tight">
              What are you studying today?
            </h1>
            <p className="mt-3 max-w-2xl text-lattice-prompt text-muted-foreground">
              Pick a course, or create one and upload its materials.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-lattice-meta font-medium text-muted-foreground">
            Signed in as
            <input
              className={inputClass}
              type="email"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </label>
        </header>

        {lastOpened && (
          <ContinueCard course={lastOpened.course} filename={lastOpened.filename} />
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lattice-heading font-semibold tracking-tight">
              Your courses
            </h2>
            <AddCourse />
          </div>
          {courses.error && (
            <p className="mt-4 text-sm text-destructive">
              {courses.error instanceof ApiError
                ? courses.error.message
                : 'Could not reach the API — is the server running?'}
            </p>
          )}
          {courses.isPending ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : merged.length === 0 ? (
            <EmptyCourses />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {merged.map((course) => (
                <CourseCard key={course.code} course={course} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function ContinueCard({ course, filename }: { course: string; filename: string }) {
  return (
    <section className="flex flex-col justify-between gap-5 rounded-xl border border-border bg-card p-6 shadow-lattice sm:flex-row sm:items-center">
      <div className="min-w-0">
        <p className="text-lattice-meta font-semibold tracking-[0.16em] text-primary">
          CONTINUE READING
        </p>
        <h2 className="mt-2 truncate text-lattice-heading font-semibold tracking-tight">
          {filename}
        </h2>
        <div className="mt-3">
          <Badge
            variant="outline"
            className="border-0 bg-source-context font-mono uppercase text-source-context-text"
          >
            {course}
          </Badge>
        </div>
      </div>
      <Button asChild size="lg" className="shrink-0">
        <Link
          to="/courses/$courseId/materials/$filename"
          params={{ courseId: course, filename }}
        >
          Open material
          <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
        </Link>
      </Button>
    </section>
  )
}

function AddCourse() {
  const { addCourse } = useLibrary()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const code = value.trim().toLowerCase()
  const invalid = value.trim() !== '' && !COURSE_RE.test(code)

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!COURSE_RE.test(code)) return
        addCourse(code)
        void navigate({ to: '/courses/$courseId', params: { courseId: code } })
      }}
    >
      <input
        className={inputClass}
        value={value}
        placeholder="New course code — e.g. cs3216"
        aria-invalid={invalid}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={!COURSE_RE.test(code)}>
        <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
        Create course
      </Button>
      {invalid && (
        <p className="w-full text-xs text-destructive">
          2–16 chars: lowercase letters and digits, starting with a letter.
        </p>
      )}
    </form>
  )
}

function EmptyCourses() {
  return (
    <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <h3 className="font-semibold tracking-tight">No courses yet</h3>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        Create a course above, then upload its materials in the workspace to
        start asking questions.
      </p>
    </div>
  )
}
