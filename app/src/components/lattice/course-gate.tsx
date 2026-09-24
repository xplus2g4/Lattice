/** Enrolment gate for course pages.
 *
 * Runs before any panel mounts: one `getCourse` probe answers "does this code
 * exist" and "is the caller enrolled". Enrolled renders the workspace; known
 * but unjoined renders a join card (enrolment is self-serve); nothing renders
 * a not-found card. The data endpoints would refuse the same way — the probe
 * just keeps the page from painting five separate 403s.
 */
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { ApiError, getCourse, joinCourse } from '#/lib/api'
import { useUser } from '#/lib/user'

import type { ReactNode } from 'react'

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-72 space-y-4 text-center">{children}</div>
    </main>
  )
}

export function CourseGate({
  courseId,
  children,
}: {
  courseId: string
  children: ReactNode
}) {
  const user = useUser()
  const queryClient = useQueryClient()
  const key = ['course-info', user, courseId]
  const info = useQuery({
    queryKey: key,
    queryFn: () => getCourse(user, courseId),
    retry: false,
  })
  const join = useMutation({
    mutationFn: () => joinCourse(user, courseId),
    onSuccess: () => {
      // The enrolment changed: refresh the probe, the home list, and /me.get.
      queryClient.invalidateQueries({ queryKey: key })
      queryClient.invalidateQueries({ queryKey: ['courses', user] })
      return queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  if (info.isPending) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Opening {courseId}…</p>
      </Shell>
    )
  }

  if (info.isError) {
    const missing = info.error instanceof ApiError && info.error.status === 404
    return (
      <Shell>
        <Badge variant="secondary" className="font-mono uppercase">
          {courseId}
        </Badge>
        <p className="text-sm">
          {missing
            ? 'No course with this code.'
            : 'Could not load this course.'}
        </p>
        {!missing && (
          <p className="text-xs text-destructive">{String(info.error)}</p>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to="/">Home</Link>
        </Button>
      </Shell>
    )
  }

  if (!info.data.enrolled) {
    return (
      <Shell>
        <Badge variant="secondary" className="font-mono uppercase">
          {info.data.code}
        </Badge>
        <div className="space-y-1">
          <p className="font-medium">{info.data.name}</p>
          <p className="text-sm text-muted-foreground">
            You are not enrolled in this course yet.
          </p>
        </div>
        <Button
          className="w-full"
          disabled={join.isPending}
          onClick={() => join.mutate()}
        >
          {join.isPending ? 'Joining…' : 'Join course'}
        </Button>
        {join.isError && (
          <p className="text-xs text-destructive">{String(join.error)}</p>
        )}
        <Button asChild variant="ghost" size="sm">
          <Link to="/">Home</Link>
        </Button>
      </Shell>
    )
  }

  return children
}
