import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'

import type { CourseSummary } from '#/lib/api'

export function CourseCard({ course }: { course: CourseSummary }) {
  return (
    <Card className="gap-4 py-5">
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
          <Button asChild size="sm" className="w-full">
            <Link
              to="/courses/$course"
              params={{ course: course.code }}
              search={{ material: undefined }}
            >
              Open workspace
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
