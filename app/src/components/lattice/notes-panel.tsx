import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PenIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Textarea } from '#/components/ui/textarea'
import {
  listNotes,
  pollWhilePending,
  saveNote,
  uploadEach,
  uploadNote,
} from '#/lib/api'
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
  // PDF Notes: every selected file becomes its own Note; failures are reported per file.
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: (files: Array<File>) =>
      uploadEach(files, (f) => uploadNote(user, course, f)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return (
    <section className="border-t border-border">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <p className="text-lattice-meta font-semibold tracking-[0.14em] text-muted-foreground">
          NOTES
        </p>
        <div className="flex items-center gap-1">
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
            <HugeiconsIcon icon={PenIcon} data-icon="inline-start" />
            Write
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length)
                upload.mutate(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {notes.error && (
        <p className="px-4 pb-1 text-xs text-destructive">
          {notes.error.message}
        </p>
      )}
      {upload.error && (
        <p className="px-4 pb-1 text-xs text-destructive">
          {upload.error.message}
        </p>
      )}
      {upload.data
        ?.filter((r) => r.error)
        .map((r) => (
          <p key={r.file.name} className="px-4 pb-1 text-xs text-destructive">
            {r.file.name}: {r.error}
          </p>
        ))}
      <ul className="space-y-0.5 px-2 pb-3">
        {notes.data?.map((n) => {
          const row = (
            <>
              <span className="flex items-center gap-2">
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${n.filename ? '' : 'font-mono'}`}
                >
                  {n.filename ?? n.id}
                </span>
                <StatusBadge status={n.status} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {n.filename ? 'PDF' : n.body_md.slice(0, 80)}
              </span>
              {n.status === 'failed' && n.error && (
                <span className="mt-0.5 block truncate text-xs text-destructive">
                  {n.error}
                </span>
              )}
            </>
          )
          const className = 'block w-full rounded-lg px-2 py-1.5 text-left'
          return (
            <li key={n.id}>
              {n.filename ? (
                // A PDF Note has no body to edit, so its row does not open the editor.
                <div className={className}>{row}</div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({ id: n.id, body: n.body_md, isNew: false })
                  }
                  className={`${className} transition-colors hover:bg-accent`}
                >
                  {row}
                </button>
              )}
            </li>
          )
        })}
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
            <DialogTitle>
              {editing?.isNew ? 'New note' : 'Edit note'}
            </DialogTitle>
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
              <Textarea
                className="min-h-40"
                placeholder="Markdown body"
                value={editing.body}
                onChange={(e) =>
                  setEditing({ ...editing, body: e.target.value })
                }
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
