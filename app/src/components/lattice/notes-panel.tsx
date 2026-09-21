import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { listNotes, pollWhilePending, saveNote } from '#/lib/api'
import { StatusBadge } from './status-badge'

import type { Enrolment } from '#/lib/api'

const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function NotesPanel({ course, user }: Enrolment) {
  const queryClient = useQueryClient()
  const key = ['notes', course, user]
  const notes = useQuery({
    queryKey: key,
    queryFn: () => listNotes(user, course),
    refetchInterval: (q) => pollWhilePending(q.state.data),
  })
  const [editing, setEditing] = useState<{
    id: string
    body: string
    isNew: boolean
  } | null>(null)
  const save = useMutation({
    mutationFn: (note: { id: string; body: string }) =>
      saveNote(user, course, note.id, note.body),
    onSuccess: () => {
      setEditing(null)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  return (
    <section className="border-t border-border">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <p className="text-lattice-meta font-semibold tracking-[0.14em] text-muted-foreground">
          NOTES
        </p>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            setEditing({
              id: `note-${Date.now().toString(36)}`,
              body: '',
              isNew: true,
            })
          }
        >
          <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
          New note
        </Button>
      </div>
      {notes.error && (
        <p className="px-4 pb-1 text-xs text-destructive">{notes.error.message}</p>
      )}
      <ul className="space-y-0.5 px-2 pb-3">
        {notes.data?.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => setEditing({ id: n.id, body: n.body_md, isNew: false })}
              className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {n.id}
                </span>
                <StatusBadge status={n.status} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {n.body_md.slice(0, 80)}
              </span>
              {n.status === 'failed' && n.error && (
                <span className="mt-0.5 block truncate text-xs text-destructive">
                  {n.error}
                </span>
              )}
            </button>
          </li>
        ))}
        {notes.data?.length === 0 && (
          <li className="px-2 py-1.5 text-sm leading-6 text-muted-foreground">
            No notes yet — notes are private to you and feed your answers.
          </li>
        )}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.isNew ? 'New note' : 'Edit note'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (NOTE_ID_RE.test(editing.id) && editing.body.trim()) {
                  save.mutate({ id: editing.id, body: editing.body })
                }
              }}
            >
              <Input
                className="font-mono"
                value={editing.id}
                disabled={!editing.isNew}
                onChange={(e) => setEditing({ ...editing, id: e.target.value })}
              />
              <Textarea
                className="min-h-40"
                placeholder="Markdown body"
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              />
              {save.error && (
                <p className="text-xs text-destructive">{save.error.message}</p>
              )}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    !NOTE_ID_RE.test(editing.id) ||
                    !editing.body.trim() ||
                    save.isPending
                  }
                >
                  {save.isPending ? 'Saving…' : 'Save note'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
