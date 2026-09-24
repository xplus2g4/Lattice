import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

import { Skeleton } from '#/components/ui/skeleton'
import { CourseCard } from '#/components/lattice/course-card'
import {
  ApiError,
  getMe,
  joinCourse,
  listCourses,
  listMaterials,
} from '#/lib/api'
import { useLibrary } from '#/lib/library'
import { useUser } from '#/lib/user'
import { COURSE_RE } from '#/lib/course'
import { cleanTitle, fileExtLabel, greeting, relativeTime } from '#/lib/format'
import { readingPosition } from '#/lib/reading-position'
import { materialTab } from '#/lib/tabs'

import type { CourseSummary } from '#/lib/api'

export const Route = createFileRoute('/_authed/')({ component: Home })

function Home() {
  const user = useUser()
  const { courses: added, lastOpened, openedAt } = useLibrary()
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
        failed_count: 0,
      })),
  ]
  // Only a genuinely empty account gets the first-run screen. A failed courses request
  // keeps the normal grid (with its error) so a real, populated account is never told to
  // start over just because the request hiccuped.
  const firstRun = courses.isSuccess && merged.length === 0
  // Cards present on load get Motion's staggered entrance below; autoAnimate only
  // picks up later mutations (a course created after mount slides into place).
  const [gridRef] = useAutoAnimate<HTMLDivElement>()

  return (
    <main className="flex-1 px-5 py-10 sm:px-10 sm:py-16">
      <div className="mx-auto max-w-[1200px] space-y-12 sm:space-y-16">
        {firstRun ? (
          <FirstRun />
        ) : (
          <>
            <Hero />
            {lastOpened && <ResumeCard lastOpened={lastOpened} user={user} />}
            <section className="space-y-0">
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-foreground pb-4">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Your courses
                  {!courses.isPending && (
                    <span className="ml-3 align-top font-mono text-xs text-primary-ink">
                      {String(merged.length).padStart(2, '0')}
                    </span>
                  )}
                </h2>
                <span className="fieldnotes-kicker hidden text-muted-foreground sm:block">
                  A place for everything you&apos;re learning
                </span>
              </div>
              {courses.error && (
                <p className="text-sm text-destructive">
                  {courses.error instanceof ApiError
                    ? courses.error.message
                    : 'Could not reach the API — is the server running?'}
                </p>
              )}
              <div ref={gridRef} className="divide-y divide-border">
                {courses.isPending ? (
                  [0, 1, 2].map((i) => (
                    <Skeleton key={i} className="my-4 h-24 rounded-none" />
                  ))
                ) : (
                  <>
                    {merged.map((course, i) => (
                      <motion.div
                        key={course.code}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.2,
                          ease: 'easeOut',
                          delay: Math.min(i, 5) * 0.04,
                        }}
                      >
                        <CourseCard
                          course={course}
                          lastOpenedAt={openedAt[course.code]}
                        />
                      </motion.div>
                    ))}
                    <AddCourseTile />
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function Hero() {
  // The account's own name, not a guess from the email; absent for accounts with no name.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
    retry: false,
  })
  const name = me.data?.user.name?.trim().split(/\s+/)[0] ?? ''
  // Read the clock on the client, after mount: the server renders in its own timezone, so
  // computing the greeting there could show the wrong part of the day until hydration.
  const [hour, setHour] = useState<number | null>(null)
  // One phrasing per visit; the name still fills in once its query resolves.
  const [seed] = useState(() => Math.random())
  useEffect(() => setHour(new Date().getHours()), [])
  return (
    <header className="grid gap-6 border-l-2 border-primary pl-5 sm:pl-8 lg:grid-cols-[1fr_240px] lg:items-end">
      <div>
        <p className="fieldnotes-kicker mb-5 text-primary-ink">
          {hour === null ? '\u00a0' : greeting(hour, name, seed)}
        </p>
        <h1 className="fieldnotes-display max-w-3xl">
          <span className="fieldnotes-reveal block">Make room for</span>
          <span className="fieldnotes-reveal fieldnotes-reveal-late block italic">
            a good question.
          </span>
        </h1>
      </div>
      <p className="max-w-sm text-base leading-7 text-muted-foreground lg:pb-2">
        Your Materials. Your Notes. A little more understanding, one course at a
        time.
      </p>
    </header>
  )
}

function ResumeCard({
  lastOpened,
  user,
}: {
  lastOpened: { course: string; filename: string; at?: string }
  user: string
}) {
  const { course, filename } = lastOpened
  const materials = useQuery({
    queryKey: ['materials', course, user],
    queryFn: () => listMaterials(course),
    enabled: !!user,
  })
  const row = materials.data?.find((m) => m.filename === filename)
  const title =
    row?.title && row.title.trim() && row.title !== filename
      ? row.title
      : cleanTitle(filename)
  const opened = relativeTime(lastOpened.at)
  const total = row?.page_count ?? undefined
  const current = readingPosition(user, course, materialTab(filename))
  const showProgress = !!(current && total)

  return (
    <section className="border-y border-border bg-card">
      <h2 className="fieldnotes-kicker px-5 pt-5 text-primary-ink sm:px-6">
        Back to where you left off
      </h2>
      <Link
        to="/courses/$course"
        params={{ course }}
        search={{ material: filename }}
        aria-label={`Resume reading ${title}`}
        className="group flex items-center gap-4 p-5 transition-colors hover:bg-accent/40 focus-visible:outline-offset-[-3px] sm:gap-6 sm:p-6"
      >
        <Thumbnail filename={filename} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-primary-ink">
              {course}
            </span>
            {opened && (
              <span className="text-xs text-muted-foreground">
                Opened {opened}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-[18px] font-semibold text-foreground">
            {title}
          </p>
          {showProgress && (
            <div className="mt-2.5 flex items-center gap-3">
              <span className="h-1.5 w-[240px] max-w-full overflow-hidden rounded-none bg-muted">
                <span
                  className="block h-full rounded-none bg-primary"
                  style={{
                    width: `${Math.min(100, (current / total) * 100)}%`,
                  }}
                />
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                Page {current} of {total}
              </span>
            </div>
          )}
        </div>
        <span className="hidden shrink-0 border-l border-border pl-6 text-sm font-semibold text-primary-ink sm:inline">
          Resume reading{' '}
          <span aria-hidden="true" className="fieldnotes-arrow ml-2">
            →
          </span>
        </span>
      </Link>
    </section>
  )
}

function Thumbnail({ filename }: { filename: string }) {
  return (
    <span className="relative flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 h-0 w-0 border-l-[14px] border-b-[14px] border-l-transparent border-b-border"
      />
      <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
        {fileExtLabel(filename)}
      </span>
    </span>
  )
}

/** Shared create-course logic: validate, create/join, then open the workspace to upload. */
function useCreateCourse() {
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
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (COURSE_RE.test(code) && !join.isPending) join.mutate()
  }
  return { value, setValue, code, invalid, join, onSubmit }
}

function AddCourseTile() {
  const { value, setValue, code, invalid, join, onSubmit } = useCreateCourse()
  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 border-b border-border py-6 sm:grid-cols-[1fr_minmax(260px,420px)] sm:items-center sm:gap-8"
    >
      <div className="flex items-start gap-4 sm:px-6">
        <HugeiconsIcon
          icon={PlusSignIcon}
          className="mt-1 size-5 shrink-0 text-primary-ink"
          strokeWidth={1.5}
        />
        <div>
          <h3 className="text-lg font-semibold">Add a course</h3>
          <label
            htmlFor="add-course"
            className="mt-1 block text-sm text-muted-foreground"
          >
            Enter the course code. Bring your Materials.
          </label>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            id="add-course"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. CS2040"
            aria-invalid={invalid}
            disabled={join.isPending}
            className="min-w-0 flex-1 min-h-11 rounded-sm border border-input bg-card px-3 py-2 font-mono text-base uppercase text-foreground outline-none placeholder:normal-case placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus:border-ring aria-invalid:border-destructive"
          />
          <button
            type="submit"
            disabled={!COURSE_RE.test(code) || join.isPending}
            className="min-h-11 shrink-0 rounded-sm bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
        {invalid && (
          <p className="text-xs text-destructive">
            2–16 chars: letters and digits, starting with a letter.
          </p>
        )}
        {join.error && (
          <p className="text-xs text-destructive">{join.error.message}</p>
        )}
      </div>
    </form>
  )
}

const UPLOAD_TYPES = ['PDF', 'Markdown', 'Text']

function FirstRun() {
  const { value, setValue, code, invalid, join, onSubmit } = useCreateCourse()
  return (
    <div className="space-y-10">
      <header className="max-w-3xl border-l-2 border-primary pl-5 sm:pl-8">
        <p className="fieldnotes-kicker mb-5 text-primary-ink">
          Welcome to Lattice
        </p>
        <h1 className="fieldnotes-display fieldnotes-reveal">
          Every good question <span className="italic">starts somewhere.</span>
        </h1>
        <p className="fieldnotes-reveal fieldnotes-reveal-late mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
          Let&apos;s set up your first course. Add your Materials, let Lattice
          Cognify them, and bring your questions.
        </p>
      </header>

      <div className="grid border-y-2 border-foreground lg:grid-cols-3">
        <StepCard n={1} title="Create a course" highlighted badge="START HERE">
          <form onSubmit={onSubmit} className="mt-3 space-y-2">
            <div className="flex gap-2">
              <label htmlFor="firstrun-course" className="sr-only">
                Course code
              </label>
              <input
                id="firstrun-course"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. CS3216"
                aria-invalid={invalid}
                disabled={join.isPending}
                className="min-w-0 flex-1 min-h-11 rounded-sm border border-input bg-card px-3 py-2 font-mono text-base uppercase text-foreground outline-none placeholder:normal-case placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus:border-ring aria-invalid:border-destructive"
              />
              <button
                type="submit"
                disabled={!COURSE_RE.test(code) || join.isPending}
                className="min-h-11 shrink-0 rounded-sm bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                Create
              </button>
            </div>
            {invalid && (
              <p className="text-xs text-destructive">
                2–16 chars: letters and digits, starting with a letter.
              </p>
            )}
            {join.error && (
              <p className="text-xs text-destructive">{join.error.message}</p>
            )}
          </form>
        </StepCard>

        <StepCard n={2} title="Add Materials">
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Lecture slides, readings, past papers. PDFs work best.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {UPLOAD_TYPES.map((t) => (
              <span
                key={t}
                className="border border-border px-2 py-1 font-mono text-xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        </StepCard>

        <StepCard n={3} title="Ask questions">
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Get answers grounded in your own materials, with the page they came
            from.
          </p>
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm italic text-muted-foreground">
            “What&apos;s the difference between a process and a thread?”
          </p>
        </StepCard>
      </div>
    </div>
  )
}

function StepCard({
  n,
  title,
  highlighted,
  badge,
  children,
}: {
  n: number
  title: string
  highlighted?: boolean
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col border-border p-6 not-last:border-b lg:not-last:border-r lg:not-last:border-b-0 sm:p-8 ${
        highlighted ? 'bg-card' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-editorial text-4xl text-primary-ink">
          {String(n).padStart(2, '0')}
        </span>
        {badge && (
          <span className="fieldnotes-kicker border-b border-primary pb-1 text-primary-ink">
            {badge}
          </span>
        )}
      </div>
      <h3 className="mt-3 text-[18px] font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}
