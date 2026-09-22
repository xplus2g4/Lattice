import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { listCourses } from '#/lib/api'
import { COURSE_RE } from '#/lib/course'
import { useLibrary } from '#/lib/library'
import { useStored, useUser } from '#/lib/user'

const sections = [
  { name: 'Materials', path: '/courses/$course/materials' },
  { name: 'Notes', path: '/courses/$course/notes' },
  { name: 'Ask', path: '/courses/$course/ask' },
  { name: 'Practice', path: '/courses/$course/quizzes' },
] as const

/** One persistent navigation rail for all product routes, including the homepage. */
export function AppShell() {
  const navigate = useNavigate()
  const { course: routeCourse, filename } = useParams({ strict: false })
  const { material } = useSearch({ strict: false })
  const pathname = useLocation({ select: (location) => location.pathname })
  const [user] = useUser()
  const [remembered, setRemembered] = useStored(
    `lattice.active-course.${user}`,
    '',
  )
  const library = useLibrary()
  const courses = useQuery({
    queryKey: ['courses', user],
    queryFn: () => listCourses(user),
    retry: false,
  })
  const current =
    routeCourse && COURSE_RE.test(routeCourse) ? routeCourse : undefined
  const options = [
    ...new Set([
      ...(courses.data ?? []).map((c) => c.code),
      ...library.courses,
      ...(current ? [current] : []),
    ]),
  ].filter((c) => COURSE_RE.test(c))
  const course =
    current ?? (options.includes(remembered) ? remembered : options.at(0))
  useEffect(() => {
    if (current && current !== remembered) setRemembered(current)
  }, [current, remembered, setRemembered])
  const itemClass =
    'flex min-h-12 items-center rounded-lg px-2 py-3 text-[11px] font-medium transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:px-3 md:text-sm'
  const activeClass = ' bg-[#f1eaff] text-[#7045cd] hover:bg-[#f1eaff]'
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        aria-label="Application sidebar"
        className="flex w-24 shrink-0 flex-col gap-5 overflow-y-auto bg-[#202b3e] px-2 py-4 text-white md:w-56 md:gap-7 md:p-4"
      >
        <Link
          to="/"
          className="flex items-center gap-2 px-1 text-sm font-semibold md:text-xl"
        >
          <span
            aria-hidden="true"
            className="hidden size-7 place-items-center rounded-lg bg-[#f1eaff] font-serif text-[#7045cd] md:grid"
          >
            L
          </span>
          Lattice
        </Link>
        <label className="space-y-2 text-[10px] md:text-xs">
          <span className="block uppercase text-white/70">Course</span>
          <select
            aria-label="Active course"
            className="min-h-10 w-full rounded-lg border border-white/20 bg-[#2d384b] p-1 text-xs uppercase text-white md:p-2"
            value={course ?? ''}
            disabled={options.length === 0}
            onChange={(event) => {
              const next = event.target.value
              if (current)
                void navigate({
                  to:
                    sections.find((section) =>
                      pathname.startsWith(
                        `/courses/${current}/${section.path.split('/').at(-1)}`,
                      ),
                    )?.path ?? '/courses/$course',
                  params: { course: next },
                  search: { material: undefined },
                })
              else setRemembered(next)
            }}
          >
            {!course && <option value="">Choose</option>}
            {options.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Main navigation" className="flex flex-col gap-2">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={itemClass}
            activeProps={{ className: itemClass + activeClass }}
          >
            Homepage
          </Link>
          {sections.map((section) => {
            const active =
              current &&
              (pathname.startsWith(
                `/courses/${current}/${section.path.split('/').at(-1)}`,
              ) ||
                (section.name === 'Materials' &&
                  (pathname === `/courses/${current}` ||
                    pathname === `/courses/${current}/`)))
            return course ? (
              <Link
                key={section.name}
                to={section.path}
                params={{ course }}
                search={{
                  material:
                    section.name === 'Practice'
                      ? (material ?? filename)
                      : undefined,
                }}
                className={itemClass + (active ? activeClass : '')}
                aria-current={active ? 'page' : undefined}
              >
                {section.name}
              </Link>
            ) : (
              <Link
                key={section.name}
                to="/"
                hash="courses"
                className={itemClass}
                title="Choose or create a course on the homepage"
              >
                {section.name}
              </Link>
            )
          })}
        </nav>
        {!course && (
          <p className="text-[10px] leading-relaxed text-white/70 md:text-xs">
            Choose or create a course to get started.
          </p>
        )}
        <p className="mt-auto hidden break-all border-t border-white/15 pt-4 text-xs text-white/70 md:block">
          {user}
        </p>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
