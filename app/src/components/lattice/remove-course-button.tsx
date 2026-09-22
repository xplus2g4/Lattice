import { useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { usesMockBackend } from '#/lib/api'
import { useCourseRemoval, useCourseRemovalState } from '#/lib/course-removal'

export function RemoveCourseButton({
  course,
  user,
}: {
  course: string
  user: string
}) {
  const [open, setOpen] = useState(false)
  const remove = useCourseRemoval()
  const state = useCourseRemovalState(user, course)
  const start = () => {
    setOpen(false)
    remove.mutate({ user, course, demo: usesMockBackend() })
  }
  if (state.isPending) {
    return (
      <div className="mt-3 border-t border-border pt-3 text-center">
        <p
          role="status"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
          />
          Removing…
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          You can keep studying in another course.
        </p>
      </div>
    )
  }
  return (
    <>
      {state.error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {state.error.message}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 w-full text-destructive"
        onClick={() => {
          if (state.error) start()
          else setOpen(true)
        }}
      >
        {state.error ? 'Retry removal' : 'Remove course'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {course.toUpperCase()}?</DialogTitle>
            <DialogDescription>
              All your notes and materials will be gone!
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes the course for everyone enrolled, including
            Notes, Materials, Sessions and Quizzes. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={start}
            >
              Remove course permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
