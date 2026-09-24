import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PenIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { useRef } from 'react'

import { Button } from '#/components/ui/button'
import { listNotes, pollWhilePending, uploadEach, uploadNote } from '#/lib/api'
import { draftNoteId } from '#/lib/tabs'
import { StatusBadge } from './status-badge'

import type { Enrolment } from '#/lib/api'

export function NotesPanel({ course, user }: Enrolment) {
  const queryClient = useQueryClient()
  const key = ['notes', course, user]
  const notes = useQuery({
    queryKey: key,
    queryFn: () => listNotes(course),
    refetchInterval: (q) => pollWhilePending(q.state.data),
  })
  const navigate = useNavigate()
  // PDF Notes: every selected file becomes its own Note; failures are reported per file.
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: (files: Array<File>) =>
      uploadEach(files, (f) => uploadNote(course, f)),
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
            // A new Note is written in its own tab; its first save gives it an id.
            onClick={() =>
              void navigate({
                to: '/courses/$course',
                params: { course },
                search: { note: draftNoteId() },
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
      <p className="px-4 pb-1.5 text-xs text-muted-foreground">
        Only you can see what you upload.
      </p>
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
          return (
            <li key={n.id}>
              {/* Every Note opens as a tab: an editor, or the reader for a PDF. */}
              <Link
                to="/courses/$course"
                params={{ course }}
                search={{ note: n.id }}
                className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
              >
                {row}
              </Link>
            </li>
          )
        })}
        {notes.data?.length === 0 && (
          <li className="px-2 py-1.5 text-sm leading-6 text-muted-foreground">
            No notes yet — write one or upload a PDF to feed your answers.
          </li>
        )}
      </ul>
    </section>
  )
}
