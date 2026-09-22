import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { RemoveCourseButton } from './remove-course-button'
import { useCourseRemovalState } from '#/lib/course-removal'

import type { CourseSummary } from '#/lib/api'

export function CourseCard({
  course,
  user,
}: {
  course: CourseSummary
  user: string
}) {
  const removal = useCourseRemovalState(user, course.code)
  return (
    <Card
      className="gap-4 py-5"
      role="group"
      aria-label={`${course.code.toUpperCase()} course`}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-5">
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
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-5">
        <p className="text-sm text-muted-foreground">
          {course.material_count}{' '}
          {course.material_count === 1 ? 'material' : 'materials'} ·{' '}
          {course.note_count} {course.note_count === 1 ? 'note' : 'notes'}
        </p>
        <div className="mt-5">
          {removal.isPending ? (
            <Button size="sm" className="w-full" disabled>
              Open course
            </Button>
          ) : (
            <Button asChild size="sm" className="w-full">
              <Link
                to="/courses/$course"
                params={{ course: course.code }}
                search={{ material: undefined }}
              >
                Open course
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              </Link>
            </Button>
          )}
          {course.can_delete && (
            <RemoveCourseButton course={course.code} user={user} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
