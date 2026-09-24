import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { CourseCard } from '#/components/lattice/course-card'
import {
  ApiError,
  createInvite,
  getMe,
  joinCourse,
  listCourses,
} from '#/lib/api'
import { useLibrary } from '#/lib/library'
import { useUser } from '#/lib/user'

import type { CourseSummary } from '#/lib/api'

export const Route = createFileRoute('/_authed/')({ component: Home })

const COURSE_RE = /^[a-z][a-z0-9]{1,15}$/

function Home() {
  const user = useUser()
  const { courses: added, lastOpened } = useLibrary()
  const courses = useQuery({
    queryKey: ['courses', user],
    queryFn: () => listCourses(),
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
          <div className="flex flex-col gap-1.5 text-lattice-meta font-medium text-muted-foreground">
            Signed in as
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground">{user}</span>
              <a
                href="/auth/logout"
                className="text-sm underline underline-offset-2 hover:text-foreground"
              >
                Sign out
              </a>
            </div>
          </div>
        </header>

        {lastOpened && (
          <ContinueCard
            course={lastOpened.course}
            filename={lastOpened.filename}
          />
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

        <InvitePanel />
      </div>
    </main>
  )
}

/** Instructors and admins mint invite links here; everyone else never sees this. */
function InvitePanel() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
    retry: false,
  })
  const [link, setLink] = useState('')
  const invite = useMutation({
    mutationFn: () => createInvite(),
    onSuccess: (data) =>
      setLink(`${window.location.origin}/invite/${data.token}`),
  })
  if (!['instructor', 'admin'].includes(me.data?.user.role ?? '')) return null
  return (
    <section className="max-w-md">
      <h2 className="text-lattice-heading font-semibold tracking-tight">
        Invite someone
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign-up is invite-only. Each link works once and expires in 7 days.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={invite.isPending}
          onClick={() => invite.mutate()}
        >
          Create invite link
        </Button>
        {invite.error && (
          <p className="text-xs text-destructive">{invite.error.message}</p>
        )}
      </div>
      {link && (
        <Input
          className="mt-3 font-mono text-xs"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  )
}

function ContinueCard({
  course,
  filename,
}: {
  course: string
  filename: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
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
              className="border-0 bg-citation-context font-mono uppercase text-citation-context-text"
            >
              {course}
            </Badge>
          </div>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link
            to="/courses/$course"
            params={{ course: course }}
            search={{ material: filename }}
          >
            Open material
            <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function AddCourse() {
  const { addCourse } = useLibrary()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const code = value.trim().toLowerCase()
  const invalid = value.trim() !== '' && !COURSE_RE.test(code)
  const join = useMutation({
    mutationFn: () => joinCourse(code),
    onSuccess: () => {
      addCourse(code)
      void navigate({
        to: '/courses/$course',
        params: { course: code },
        search: { material: undefined },
      })
    },
  })

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (COURSE_RE.test(code) && !join.isPending) join.mutate()
      }}
    >
      <Input
        className="w-auto"
        value={value}
        placeholder="New course code — e.g. cs3216"
        aria-invalid={invalid}
        disabled={join.isPending}
        onChange={(e) => setValue(e.target.value)}
      />
      {join.error && (
        <p className="w-full text-xs text-destructive">{join.error.message}</p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={!COURSE_RE.test(code) || join.isPending}
      >
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
    <Card className="mt-4 items-center gap-3 border-dashed px-6 py-14 text-center shadow-none">
      <h3 className="font-semibold tracking-tight">No courses yet</h3>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        Create a course above, then upload its materials in the workspace to
        start asking questions.
      </p>
    </Card>
  )
}
