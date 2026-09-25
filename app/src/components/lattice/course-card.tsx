import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
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
    <div className="group relative flex h-full min-h-[236px] min-w-0 flex-col rounded-[18px] border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-within:border-primary/40 motion-safe:hover:-translate-y-0.5">
      {/* Stretched link: the whole card opens the workspace, while the name editor below
          sits above it and stays clickable on its own. */}
      <Link
        to="/courses/$course"
        params={{ course: course.code }}
        search={{ material: undefined }}
        aria-label={`Open ${name || course.code.toUpperCase()} workspace`}
        className="absolute inset-0 z-0 rounded-[18px] focus-visible:outline-offset-[-3px]"
      />

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-primary-ink">
            {course.code}
          </span>
          <CourseStatus
            pending={course.pending_count}
            failed={course.failed_count}
          />
        </div>

        <div className="mt-4 min-w-0 flex-1">
          <CourseName code={course.code} name={name} />
          <p className="mt-1.5 text-sm text-muted-foreground">
            {course.material_count}{' '}
            {course.material_count === 1 ? 'material' : 'materials'} ·{' '}
            {course.note_count} {course.note_count === 1 ? 'note' : 'notes'}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="truncate text-xs text-muted-foreground">
            {opened ? `Last opened ${opened}` : 'Not opened yet'}
          </span>
          <span className="shrink-0 text-sm font-semibold text-primary-ink">
            Open{' '}
            <span aria-hidden="true" className="fieldnotes-arrow ml-2">
              →
            </span>
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
  const state = pending > 0 ? 'pending' : failed > 0 ? 'failed' : 'ready'
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state === 'pending' ? (
        <motion.span
          key="pending"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-1.5 rounded-xs bg-feedback-developing px-2 py-1 text-xs font-medium text-feedback-developing-text"
        >
          <span
            aria-hidden="true"
            className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current"
          />
          Cognifying {pending}
        </motion.span>
      ) : state === 'failed' ? (
        <motion.span
          key="failed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-1 rounded-xs bg-feedback-revisit px-2 py-1 text-xs font-medium text-feedback-revisit-text"
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            className="size-4"
            strokeWidth={2.5}
          />
          {failed} failed
        </motion.span>
      ) : (
        <motion.span
          key="ready"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-feedback-strong-text"
        >
          <motion.span
            initial={{ scale: 0.4 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            className="flex"
          >
            <HugeiconsIcon
              icon={Tick02Icon}
              className="size-4"
              strokeWidth={2.5}
            />
          </motion.span>
          Ready
        </motion.span>
      )}
    </AnimatePresence>
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
          className="min-h-11 min-w-0 flex-1 rounded-sm border border-input bg-card px-2.5 py-1.5 text-base font-semibold text-foreground focus:border-ring"
        />
        <button
          type="submit"
          disabled={rename.isPending}
          className="min-h-11 shrink-0 rounded-sm bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
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
        className="pointer-events-auto relative z-20 min-h-11 text-left text-[20px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
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
      className="fieldnotes-action pointer-events-auto relative z-20 min-h-11 max-w-full truncate text-left text-[22px] font-semibold text-foreground hover:text-primary-ink"
    >
      {name}
    </button>
  )
}
