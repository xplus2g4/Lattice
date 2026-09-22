import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { getPageNote, notesCognifyEnabled, savePageNote } from '#/lib/api'
import { pageNoteDraft } from '#/lib/page-note-draft'
import type { PageNote } from '#/lib/api'

interface Props {
  user: string
  course: string
  material: string
  page: number
}

export function PageNoteEditor(props: Props) {
  const { user, material, page } = props
  const enabled = useQuery({
    queryKey: ['notes-cognify-enabled', user],
    queryFn: () => notesCognifyEnabled(user),
  })
  const note = useQuery({
    queryKey: ['page-note', user, material, page],
    queryFn: () => getPageNote(user, material, page),
    retry: false,
    refetchInterval: (q) =>
      enabled.data !== false &&
      ['dirty', 'indexing'].includes(q.state.data?.status ?? '')
        ? 2000
        : false,
  })
  return (
    <section
      aria-label={`Private Note for page ${page}`}
      className="shrink-0 border-t border-border bg-card p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor="page-note-body" className="text-sm font-semibold">
          Your Note · Page {page}
        </label>
        <span className="text-xs text-muted-foreground">Private to you</span>
      </div>
      {note.isPending ? (
        <p className="text-sm text-muted-foreground">Loading Note…</p>
      ) : note.data !== undefined ? (
        <LoadedEditor
          key={JSON.stringify([user, material, page])}
          {...props}
          initial={note.data}
          cognifyEnabled={enabled.data}
        />
      ) : (
        <div role="alert" className="text-sm text-destructive">
          Could not load your Note.{' '}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void note.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
    </section>
  )
}

function LoadedEditor({
  user,
  course,
  material,
  page,
  initial,
  cognifyEnabled,
}: Props & { initial: PageNote | null; cognifyEnabled: boolean | undefined }) {
  const client = useQueryClient()
  const [draft] = useState(() =>
    pageNoteDraft(
      client,
      `lattice.page-note-draft.${JSON.stringify([user, course, material, page])}`,
      initial,
      (body, revision) =>
        savePageNote(user, course, material, page, body, revision),
      (note) => {
        client.setQueryData(['page-note', user, material, page], note)
        void client.invalidateQueries({ queryKey: ['notes', course, user] })
      },
    ),
  )
  const state = useSyncExternalStore(
    draft.subscribe,
    draft.snapshot,
    draft.snapshot,
  )
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  useEffect(() => {
    draft.observe(initial)
  }, [draft, initial])
  useEffect(() => {
    // Resume a recovered draft; flush on Page changes and navigation as well as debounce.
    void draft.flush()
    return () => {
      void draft.flush()
    }
  }, [draft])
  async function resolve(keepDraft: boolean) {
    setResolving(true)
    setResolveError('')
    try {
      const latest = await getPageNote(user, material, page)
      draft.resolve(latest, keepDraft)
    } catch {
      setResolveError(
        'Could not load the latest Note. Your draft is unchanged.',
      )
    } finally {
      setResolving(false)
    }
  }

  const status =
    state.phase === 'saved'
      ? state.saved === null
        ? 'Autosaves as you write'
        : cognifyEnabled === false
          ? 'Saved · Cognify is turned off for your Notes'
          : state.saved.status === 'failed'
            ? 'Saved · Cognify failed'
            : state.saved.cognified_revision === state.saved.revision
              ? state.saved.body_md.trim()
                ? 'Saved · ready for Ask'
                : 'Saved · Note cleared'
              : state.saved.status === 'indexing'
                ? 'Saved · cognifying'
                : 'Saved · waiting to Cognify'
      : state.phase === 'saving'
        ? 'Saving…'
        : state.phase === 'unsaved'
          ? 'Unsaved changes'
          : state.phase === 'conflict'
            ? 'This Note changed elsewhere. Your draft has been kept.'
            : 'Could not save. Your draft has been kept.'

  return (
    <div className="space-y-2">
      <Textarea
        id="page-note-body"
        value={state.body}
        maxLength={50000}
        className="min-h-24 max-h-48 resize-y"
        placeholder="Write your understanding of this page…"
        onChange={(event) => draft.edit(event.target.value)}
        onBlur={() => void draft.flush()}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
        {state.phase !== 'conflict' && state.phase !== 'saved' && (
          <Button
            size="xs"
            variant="outline"
            disabled={state.phase === 'saving'}
            onClick={() => void draft.flush()}
          >
            {state.phase === 'error' ? 'Retry save' : 'Save now'}
          </Button>
        )}
      </div>
      {state.phase === 'conflict' && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={resolving}
            onClick={() => void resolve(false)}
          >
            Use saved Note
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={resolving}
            onClick={() => void resolve(true)}
          >
            Replace with my draft
          </Button>
        </div>
      )}
      {(resolveError || state.error) && (
        <p role="alert" className="text-xs text-destructive">
          {resolveError || state.error}
        </p>
      )}
      {!state.recoverable && state.phase !== 'saved' && (
        <p role="alert" className="text-xs text-destructive">
          Browser draft storage is unavailable. Keep this tab open until your
          Note is saved.
        </p>
      )}
    </div>
  )
}
