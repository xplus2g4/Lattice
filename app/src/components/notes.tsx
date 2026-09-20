import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { listNotes, saveNote } from '#/lib/api'
import type { Note } from '#/lib/api'
import {
  EmptyState,
  ErrorLine,
  Icon,
  PageHeading,
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
  const [noteId, setNoteId] = useState('')
  const [body, setBody] = useState('')
  const [savedBody, setSavedBody] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const save = useMutation({
    mutationFn: () => saveNote(user, course, noteId, body),
    onSuccess: (note) => {
      setSelectedId(note.id)
      setSavedBody(note.body_md)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const openNote = (note?: Note) => {
    if (
      body !== savedBody &&
      !window.confirm('Discard unsaved changes to this Note?')
    )
      return
    setSelectedId(note?.id ?? null)
    setNoteId(note?.id ?? '')
    setBody(note?.body_md ?? '')
    setSavedBody(note?.body_md ?? '')
    save.reset()
  }
  const filtered =
    notes.data?.filter((n) =>
      `${n.id} ${n.body_md}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? []
  const idOk = /^[A-Za-z0-9_-]{1,64}$/.test(noteId)
  const duplicateId =
    selectedId === null && notes.data?.some((n) => n.id === noteId)

  return (
    <section className="page">
      <PageHeading
        eyebrow={`${course.toUpperCase()} / PRIVATE TIER`}
        title="Your thinking space"
        description="Make connections in your own words. Your Notes are only yours."
      >
        <button
          className="button button-secondary"
          type="button"
          disabled={save.isPending}
          onClick={() => openNote()}
        >
          <Icon name="plus" />
          New Note
        </button>
      </PageHeading>
      <div className="notes-workspace">
        <aside className="panel notes-library">
          <header className="panel-heading">
            <h2>
              Notes{' '}
              <span className="count-badge">{notes.data?.length ?? '—'}</span>
            </h2>
            <Icon name="lock" size={16} />
          </header>
          <label className="search-field">
            <Icon name="search" size={16} />
            <input
              aria-label="Search Notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a thought…"
            />
          </label>
          <ErrorLine error={notes.error} />
          {notes.isPending && (
            <p className="loading-line" role="status">
              Loading Notes…
            </p>
          )}
          {notes.isSuccess && filtered.length === 0 && (
            <EmptyState
              icon="note"
              title={search ? 'No matching Notes.' : 'No notes yet.'}
            >
              {search ? 'Try another word.' : 'Your next idea belongs here.'}
            </EmptyState>
          )}
          <ul className="note-list">
            {filtered.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`note-list-item ${selectedId === n.id ? 'selected' : ''}`}
                  onClick={() => openNote(n)}
                  disabled={save.isPending}
                >
                  <strong>{n.id}</strong>
                  <span className="note-excerpt">{n.body_md.slice(0, 80)}</span>
                  <StatusBadge status={n.status} />
                </button>
                {n.status === 'failed' && n.error && (
                  <p className="error-line">{n.error}</p>
                )}
              </li>
            ))}
          </ul>
        </aside>
        <section className="panel note-editor">
          <header className="panel-heading">
            <span className="eyebrow">
              {selectedId ? 'EDIT YOUR NOTE' : 'A NEW THOUGHT'}
            </span>
            <span className="privacy-caption">
              <Icon name="lock" size={13} />
              Private Note
            </span>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (idOk && body.trim() && !duplicateId && !save.isPending)
                save.mutate()
            }}
          >
            <label className="field-label">
              Note ID
              <input
                className={inputClass}
                value={noteId}
                pattern="[A-Za-z0-9_\-]{1,64}"
                maxLength={64}
                required
                placeholder="note id"
                readOnly={selectedId !== null}
                disabled={save.isPending}
                onChange={(e) => {
                  setNoteId(e.target.value)
                  save.reset()
                }}
              />
            </label>
            <p className="muted small">
              A short name, such as lecture-01. Use letters, numbers, hyphens,
              or underscores.
            </p>
            <label className="sr-only" htmlFor="note-body">
              Note content
            </label>
            <textarea
              id="note-body"
              className="note-body"
              rows={15}
              value={body}
              placeholder="Markdown body"
              maxLength={50000}
              disabled={save.isPending}
              onChange={(e) => {
                setBody(e.target.value)
                save.reset()
              }}
            />
            {duplicateId && (
              <p className="error-line">
                That Note ID already exists. Select the existing Note to edit
                it.
              </p>
            )}
            <ErrorLine error={save.error} />
            <footer className="editor-footer">
              <span className="muted small" role="status">
                {save.isSuccess
                  ? 'Saved. Cognify status appears in your Notes list.'
                  : body !== savedBody
                    ? 'Unsaved changes · Markdown supported'
                    : 'Markdown supported'}
              </span>
              <button
                className={buttonClass}
                type="submit"
                disabled={
                  !idOk || !body.trim() || duplicateId || save.isPending
                }
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </form>
        </section>
        <aside className="notes-guide">
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>Think it through.</h2>
          <p>
            Capture what clicked, what didn’t, and the connections you want to
            explore.
          </p>
          <div className="guide-rule" />
          <Icon name="spark" />
          <h3>Part of your study context</h3>
          <p>
            Once cognified, your Notes can inform answers alongside course
            Materials. The answer tells you which tier it used.
          </p>
          <div className="guide-rule" />
          <span className="tag">PLANNED</span>
          <h3>Feedback, not yet</h3>
          <p>
            Automated Note evaluation isn’t available. No correctness score is
            assigned to your writing.
          </p>
        </aside>
      </div>
    </section>
  )
}
