import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { updateCourse } from '#/lib/api'
import { relativeTime } from '#/lib/format'

import type { CourseSummary } from '#/lib/api'

export function CourseCard({
  course,
  lastOpenedAt,
}: {
  course: CourseSummary
  lastOpenedAt?: string
}) {
  const name = course.name?.trim()
  const opened = relativeTime(lastOpenedAt)

  return (
    <div className="group relative flex min-h-[236px] flex-col rounded-[18px] border border-[#E3E8E6] bg-white p-5 shadow-[0_1px_2px_rgba(14,38,34,0.04)] transition-all hover:border-[#C4D3CF] hover:shadow-[0_6px_20px_rgba(14,38,34,0.08)] focus-within:border-[#C4D3CF]">
      {/* Stretched link: the whole card opens the workspace, while the name editor below
          sits above it and stays clickable on its own. */}
      <Link
        to="/courses/$course"
        params={{ course: course.code }}
        search={{ material: undefined }}
        aria-label={`Open ${name || course.code.toUpperCase()} workspace`}
        className="absolute inset-0 z-0 rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-[#0F7F6E]/40"
      />

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-[#E6F5F1] px-2.5 py-1 font-mono text-xs font-semibold uppercase text-[#0F7F6E]">
            {course.code}
          </span>
          <CourseStatus
            pending={course.pending_count}
            failed={course.failed_count}
          />
        </div>

        <div className="mt-4 flex-1">
          <CourseName code={course.code} name={name} />
          <p className="mt-1.5 text-sm text-[#5B6B67]">
            {course.material_count}{' '}
            {course.material_count === 1 ? 'material' : 'materials'} ·{' '}
            {course.note_count} {course.note_count === 1 ? 'note' : 'notes'}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#E3E8E6] pt-3">
          <span className="truncate text-xs text-[#5B6B67]">
            {opened ? `Last opened ${opened}` : 'Not opened yet'}
          </span>
          <span className="shrink-0 text-sm font-semibold text-[#0F7F6E]">
            Open →
          </span>
        </div>
      </div>
    </div>
  )
}

function CourseStatus({
  pending,
  failed,
}: {
  pending: number
  failed: number
}) {
  if (pending > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF3D6] px-2.5 py-1 text-xs font-semibold text-[#7A4F00]">
        <span
          aria-hidden="true"
          className="size-3 animate-spin rounded-full border-2 border-[#7A4F00]/40 border-t-[#7A4F00]"
        />
        Indexing {pending} {pending === 1 ? 'file' : 'files'}
      </span>
    )
  }
  if (failed > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEA] px-2.5 py-1 text-xs font-semibold text-[#B3261E]">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="size-4"
          strokeWidth={2.5}
        />
        {failed} failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F7F6E]">
      <HugeiconsIcon icon={Tick02Icon} className="size-4" strokeWidth={2.5} />
      Ready
    </span>
  )
}

function CourseName({ code, name }: { code: string; name?: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name ?? '')
  const rename = useMutation({
    mutationFn: (next: string) => updateCourse(code, next),
    onSuccess: () => {
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
  })

  if (editing) {
    return (
      <form
        className="pointer-events-auto relative z-20 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const next = value.trim()
          if (next && !rename.isPending) rename.mutate(next)
        }}
      >
        <input
          autoFocus
          value={value}
          aria-label={`Name for ${code.toUpperCase()}`}
          placeholder="Course name"
          disabled={rename.isPending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 flex-1 rounded-lg border border-[#CFE0DC] px-2.5 py-1.5 text-base font-semibold text-[#0E2622] outline-none focus:border-[#0F7F6E]"
        />
        <button
          type="submit"
          disabled={rename.isPending}
          className="shrink-0 rounded-lg bg-[#0E2622] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Save
        </button>
      </form>
    )
  }

  if (!name) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="pointer-events-auto relative z-20 text-left text-[20px] font-semibold text-[#5B6B67] underline decoration-dotted underline-offset-4 hover:text-[#0E2622]"
      >
        Add a course name
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(name)
        setEditing(true)
      }}
      aria-label={`Rename ${name}`}
      className="pointer-events-auto relative z-20 max-w-full truncate text-left text-[20px] font-semibold text-[#0E2622] hover:text-[#0F7F6E]"
    >
      {name}
    </button>
  )
}
