import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import type { CourseSummary } from '#/lib/api'

export function CourseCard({ course }: { course: CourseSummary }) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-lattice">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-mono uppercase">
          {course.code}
        </Badge>
        {course.pending_count > 0 && (
          <Badge
            variant="outline"
            className="border-0 bg-feedback-developing text-feedback-developing-text"
          >
            cognifying {course.pending_count}
          </Badge>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {course.material_count}{' '}
        {course.material_count === 1 ? 'material' : 'materials'} ·{' '}
        {course.note_count} {course.note_count === 1 ? 'note' : 'notes'}
      </p>
      <div className="mt-5">
        <Button asChild size="sm" className="w-full">
          <Link to="/courses/$courseId" params={{ courseId: course.code }}>
            Open workspace
            <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </article>
  )
}
