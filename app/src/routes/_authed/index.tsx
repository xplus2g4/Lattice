import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
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

  return (
    <main className="flex-1 px-5 py-10 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-[1120px] space-y-10">
        {firstRun ? (
          <FirstRun />
        ) : (
          <>
            <Hero />
            {lastOpened && <ResumeCard lastOpened={lastOpened} user={user} />}
            <section className="space-y-5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-[26px] font-bold tracking-tight text-[#0E2622]">
                  Your courses
                </h2>
                {!courses.isPending && (
                  <span className="text-[15px] text-[#5B6B67]">
                    {merged.length}
                  </span>
                )}
              </div>
              {courses.error && (
                <p className="text-sm text-destructive">
                  {courses.error instanceof ApiError
                    ? courses.error.message
                    : 'Could not reach the API — is the server running?'}
                </p>
              )}
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {courses.isPending ? (
                  [0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-[236px] rounded-[18px]" />
                  ))
                ) : (
                  <>
                    {merged.map((course) => (
                      <CourseCard
                        key={course.code}
                        course={course}
                        lastOpenedAt={openedAt[course.code]}
                      />
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
    <header>
      <p className="text-[15px] font-semibold text-[#0F7F6E]">
        {hour === null ? '\u00a0' : greeting(hour, name, seed)}
      </p>
      <h1 className="mt-2 text-[52px] font-bold leading-[1.05] tracking-[-0.02em] text-[#0E2622]">
        What are you studying today?
      </h1>
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
    <section className="space-y-3">
      <h2 className="text-[14px] font-semibold uppercase tracking-[0.08em] text-[#5B6B67]">
        Pick up where you left off
      </h2>
      <Link
        to="/courses/$course"
        params={{ course }}
        search={{ material: filename }}
        aria-label={`Resume reading ${title}`}
        className="group flex items-center gap-5 rounded-[18px] border border-[#E3E8E6] bg-white p-4 shadow-[0_1px_2px_rgba(14,38,34,0.04)] outline-none transition-all hover:border-[#C4D3CF] hover:shadow-[0_6px_20px_rgba(14,38,34,0.08)] focus-visible:ring-2 focus-visible:ring-[#0F7F6E]/40"
      >
        <Thumbnail filename={filename} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#E6F5F1] px-2.5 py-1 font-mono text-xs font-semibold uppercase text-[#0F7F6E]">
              {course}
            </span>
            {opened && (
              <span className="text-xs text-[#5B6B67]">Opened {opened}</span>
            )}
          </div>
          <p className="mt-1.5 truncate text-[18px] font-semibold text-[#0E2622]">
            {title}
          </p>
          {showProgress && (
            <div className="mt-2.5 flex items-center gap-3">
              <span className="h-1.5 w-[240px] max-w-full overflow-hidden rounded-full bg-[#E3E8E6]">
                <span
                  className="block h-full rounded-full bg-[#0F7F6E]"
                  style={{
                    width: `${Math.min(100, (current / total) * 100)}%`,
                  }}
                />
              </span>
              <span className="shrink-0 text-xs text-[#5B6B67]">
                Page {current} of {total}
              </span>
            </div>
          )}
        </div>
        <span className="hidden shrink-0 rounded-4xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors group-hover:bg-primary/80 sm:inline">
          Resume reading →
        </span>
      </Link>
    </section>
  )
}

function Thumbnail({ filename }: { filename: string }) {
  return (
    <span className="relative flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-[#E3E8E6] bg-[#F6F8F7]">
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 h-0 w-0 border-l-[14px] border-b-[14px] border-l-transparent border-b-[#E3E8E6]"
      />
      <span className="rounded bg-[#0E2622] px-1.5 py-0.5 text-[10px] font-bold text-white">
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
      className="flex min-h-[236px] flex-col rounded-[18px] border-[1.5px] border-dashed border-[#C4D3CF] bg-transparent p-5 transition-colors focus-within:border-[#0F7F6E]"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-[#E6F5F1] text-[#0F7F6E]">
        <HugeiconsIcon
          icon={PlusSignIcon}
          className="size-5"
          strokeWidth={2.5}
        />
      </span>
      <h3 className="mt-3 text-[18px] font-semibold text-[#0E2622]">
        Add a course
      </h3>
      <label htmlFor="add-course" className="mt-1 text-sm text-[#5B6B67]">
        Enter the module code, then upload its materials.
      </label>
      <div className="mt-auto space-y-2 pt-4">
        <div className="flex gap-2">
          <input
            id="add-course"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. CS2040"
            aria-invalid={invalid}
            disabled={join.isPending}
            className="min-w-0 flex-1 rounded-lg border border-[#CFE0DC] bg-white px-3 py-2 font-mono text-sm uppercase text-[#0E2622] outline-none placeholder:normal-case placeholder:text-[#5B6B67] focus:border-[#0F7F6E] aria-invalid:border-destructive"
          />
          <button
            type="submit"
            disabled={!COURSE_RE.test(code) || join.isPending}
            className="shrink-0 rounded-lg bg-[#0E2622] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0E2622]/90 disabled:opacity-50"
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
      <header className="max-w-[640px]">
        <p className="text-[15px] font-semibold text-[#0F7F6E]">
          Welcome to Lattice
        </p>
        <h1 className="mt-2 text-[52px] font-bold leading-[1.05] tracking-[-0.02em] text-[#0E2622]">
          Let&apos;s set up your first course.
        </h1>
        <p className="mt-4 text-[19px] leading-relaxed text-[#5B6B67]">
          Add a module, drop in its slides and readings, and you can start
          asking questions about them in a minute or two.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <StepCard n={1} title="Create a course" highlighted badge="START HERE">
          <form onSubmit={onSubmit} className="mt-3 space-y-2">
            <div className="flex gap-2">
              <label htmlFor="firstrun-course" className="sr-only">
                Module code
              </label>
              <input
                id="firstrun-course"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. CS3216"
                aria-invalid={invalid}
                disabled={join.isPending}
                className="min-w-0 flex-1 rounded-lg border border-[#CFE0DC] bg-white px-3 py-2 font-mono text-sm uppercase text-[#0E2622] outline-none placeholder:normal-case placeholder:text-[#5B6B67] focus:border-[#0F7F6E] aria-invalid:border-destructive"
              />
              <button
                type="submit"
                disabled={!COURSE_RE.test(code) || join.isPending}
                className="shrink-0 rounded-lg bg-[#0E2622] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0E2622]/90 disabled:opacity-50"
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

        <StepCard n={2} title="Upload materials">
          <p className="mt-2 text-sm leading-6 text-[#5B6B67]">
            Lecture slides, readings, past papers. PDFs work best.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {UPLOAD_TYPES.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[#E6F5F1] px-2.5 py-1 text-xs font-medium text-[#0F7F6E]"
              >
                {t}
              </span>
            ))}
          </div>
        </StepCard>

        <StepCard n={3} title="Ask questions">
          <p className="mt-2 text-sm leading-6 text-[#5B6B67]">
            Get answers grounded in your own materials, with the page they came
            from.
          </p>
          <p className="mt-3 rounded-lg bg-[#F6F8F7] px-3 py-2 text-sm italic text-[#5B6B67]">
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
      className={`flex flex-col rounded-[18px] border bg-white p-5 ${
        highlighted
          ? 'border-primary shadow-[0_8px_24px_rgba(14,38,34,0.08)]'
          : 'border-[#E3E8E6] shadow-[0_1px_2px_rgba(14,38,34,0.04)]'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#0E2622] text-sm font-semibold text-white">
          {n}
        </span>
        {badge && (
          <span className="rounded-full bg-primary/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#0F7F6E]">
            {badge}
          </span>
        )}
      </div>
      <h3 className="mt-3 text-[18px] font-semibold text-[#0E2622]">{title}</h3>
      {children}
    </div>
  )
}
