import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Markdown } from '#/components/lattice/answer'
import { FileViewer } from '#/components/lattice/material-viewer'
import { downloadNote, listNotes, saveNote } from '#/lib/api'
import { isDraftNote, noteTab } from '#/lib/tabs'

import type {
  PageRange,
  ReadingPosition,
} from '#/components/lattice/material-viewer'
import type { Note } from '#/lib/api'
import type { TabKey } from '#/lib/tabs'

// Unsaved text by tab, kept outside React state: typing re-renders only the editor, and
// a draft outlives its editor being unmounted, as when its tab moves to the other group.
const drafts = new Map<TabKey, string>()

export function discardDraft(tab: TabKey) {
  drafts.delete(tab)
}

export interface NoteTabEvents {
  /** The tab gained or lost unsaved edits. */
  onDirtyChange: (tab: TabKey, dirty: boolean) => void
  /** A draft Note's first save gave it an id, so its tab is now `to`. */
  onSaved: (from: TabKey, to: TabKey) => void
}

/** A Note's tab: an editor for a typed Note, the PDF reader for an uploaded one. */
export function NoteTab({
  user,
  course,
  id,
  onDirtyChange,
  onSaved,
  ...reading
}: {
  user: string
  course: string
  id: string
} & NoteTabEvents &
  PageRange &
  ReadingPosition) {
  const notes = useQuery({
    queryKey: ['notes', course, user],
    queryFn: () => listNotes(course),
  })
  const note = notes.data?.find((n) => n.id === id)
  if (!note && !isDraftNote(id)) {
    return notes.error ? (
      <p className="p-6 text-sm text-destructive">{notes.error.message}</p>
    ) : (
      <p className="p-6 text-sm text-muted-foreground">Loading…</p>
    )
  }
  if (note?.filename) {
    return (
      <FileViewer
        source={{
          queryKey: ['note-file', course, id, user],
          filename: note.filename,
          load: () => downloadNote(id),
        }}
        {...reading}
      />
    )
  }
  return (
    <NoteEditor
      user={user}
      course={course}
      id={id}
      saved={note?.body_md ?? ''}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
    />
  )
}

function NoteEditor({
  user,
  course,
  id,
  saved,
  onDirtyChange,
  onSaved,
}: {
  user: string
  course: string
  id: string
  /** The body as the server has it; an empty draft has none. */
  saved: string
} & NoteTabEvents) {
  const queryClient = useQueryClient()
  const tab = noteTab(id)
  const [body, setBody] = useState(() => drafts.get(tab) ?? saved)
  const dirty = body !== saved
  // Rendered by default, as VS Code's Markdown preview is; double-click to edit. A new
  // Note, or one with unsaved text, opens where the writing is.
  const [editing, setEditing] = useState(
    () => isDraftNote(id) || drafts.has(tab),
  )

  useEffect(() => {
    onDirtyChange(tab, dirty)
  }, [tab, dirty, onDirtyChange])

  const save = useMutation({
    mutationFn: (text: string) => saveNote(course, id, text),
    onSuccess: (note: Note, text) => {
      // Into the cache at once, so the editor sees its text as saved without a refetch.
      queryClient.setQueryData<Array<Note>>(['notes', course, user], (old) => [
        note,
        ...(old ?? []).filter((n) => n.id !== note.id),
      ])
      void queryClient.invalidateQueries({ queryKey: ['notes', course, user] })
      // Anything typed while saving is still a draft, under the tab's new name if any.
      const pending = drafts.get(tab)
      drafts.delete(tab)
      const next = noteTab(note.id)
      if (pending !== undefined && pending !== text) drafts.set(next, pending)
      if (next !== tab) onSaved(tab, next)
    },
  })
  const canSave = dirty && body.trim() !== '' && !save.isPending
  const submit = () => {
    if (canSave) save.mutate(body)
  }

  return (
    <form
      className="flex h-full flex-col bg-card"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {save.error ? (
            <span className="text-destructive">{save.error.message}</span>
          ) : dirty ? (
            'Unsaved changes'
          ) : (
            'Saved. Notes are private to you and feed your answers.'
          )}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Preview' : 'Edit'}
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {editing ? (
        <NoteTextarea
          body={body}
          onChange={(value) => {
            setBody(value)
            if (value === saved) drafts.delete(tab)
            else drafts.set(tab, value)
          }}
          onSave={submit}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div
          title="Double-click to edit"
          onDoubleClick={() => setEditing(true)}
          className="mx-auto min-h-0 w-full max-w-[72ch] flex-1 overflow-y-auto px-6 py-8"
        >
          {body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              Empty note. Double-click to write.
            </p>
          )}
        </div>
      )}
    </form>
  )
}

/** Where a Note is written. Opens focused, since it opens because the student asked. */
function NoteTextarea({
  body,
  onChange,
  onSave,
  onDone,
}: {
  body: string
  onChange: (value: string) => void
  onSave: () => void
  /** Back to the rendered preview; unsaved text stays. */
  onDone: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Textarea
      ref={ref}
      aria-label="Note body"
      placeholder="Markdown body"
      value={body}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Save as an editor does; Escape returns to the preview.
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          onSave()
        }
        if (e.key === 'Escape') onDone()
      }}
      className="mx-auto min-h-0 w-full max-w-[80ch] flex-1 resize-none rounded-none border-0 bg-card px-6 py-8 font-mono leading-7 shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    />
  )
}
