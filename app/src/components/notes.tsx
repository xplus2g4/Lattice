import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { listNotes, renameNote, saveNote, usesMockBackend } from '#/lib/api'
import type { Note } from '#/lib/api'
import {
  ErrorLine,
  StatusBadge,
  buttonClass,
  inputClass,
  pollWhilePending,
} from '#/components/common'
import type { Scope } from '#/components/common'

export function Notes({ course, user }: Scope) {
  const queryClient = useQueryClient()
  const key = ['notes', course, user]
  const notes = useQuery({
    queryKey: key,
    queryFn: () => listNotes(user, course),
    refetchInterval: (q) => pollWhilePending<Note>(q.state.data),
  })
  const [noteId, setNoteId] = useState(() => (usesMockBackend() ? 'n1' : ''))
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('Untitled Note')
  const [selected, setSelected] = useState<Note | null>(null)
  const save = useMutation({
    mutationFn: () =>
      selected && selected.body_md === body
        ? renameNote(user, course, noteId, title.trim())
        : saveNote(
            user,
            course,
            noteId,
            body,
            title.trim(),
            selected?.revision,
          ),
    onSuccess: (note) => {
      setNoteId(note.id)
      setSelected(note)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Notes</h2>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setNoteId(usesMockBackend() ? crypto.randomUUID() : '')
          setBody('')
          setTitle('Untitled Note')
          setSelected(null)
        }}
      >
        New Note
      </button>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>Note title</span>
          <input
            className={inputClass}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <textarea
          className={`${inputClass} block w-full`}
          rows={4}
          value={body}
          placeholder="Markdown body"
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          className={buttonClass}
          type="submit"
          disabled={!title.trim() || !body.trim() || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      <ErrorLine error={save.error} />
      <ErrorLine error={notes.error} />
      <ul className="divide-y divide-gray-200">
        {notes.data?.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-2 py-1">
            <button
              type="button"
              className="text-sm"
              onClick={() => {
                setNoteId(n.id)
                setBody(n.body_md)
                setTitle(n.title)
                setSelected(n)
              }}
            >
              {n.title}
            </button>
            <StatusBadge status={n.status} />
            <span className="text-sm text-gray-600">
              {n.body_md.slice(0, 80)}
            </span>
            {n.status === 'failed' && n.error && (
              <span className="text-xs text-red-700">{n.error}</span>
            )}
          </li>
        ))}
        {notes.data?.length === 0 && (
          <li className="text-sm text-gray-500">No notes yet.</li>
        )}
      </ul>
    </section>
  )
}
