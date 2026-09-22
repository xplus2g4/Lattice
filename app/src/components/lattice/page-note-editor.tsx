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
      className="shrink-0 bg-card p-4 sm:p-5"
    >
      <div className="mb-4 space-y-1 border-b border-border pb-4">
        <label htmlFor="page-note-body" className="text-sm font-semibold">
          Your Note · Page {page}
        </label>
        <p className="text-xs text-muted-foreground">
          Private to you · Saved automatically
        </p>
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

  const saveStatus =
    state.phase === 'saved'
      ? state.saved === null
        ? 'Autosaves as you write'
        : 'Saved'
      : state.phase === 'saving'
        ? 'Saving…'
        : state.phase === 'unsaved'
          ? 'Unsaved changes'
          : state.phase === 'conflict'
            ? 'This Note changed elsewhere. Your draft has been kept.'
            : 'Could not save. Your draft has been kept.'

  const cognifyStatus =
    cognifyEnabled === false
      ? 'Turned off for your Notes'
      : state.phase !== 'saved'
        ? 'Waiting for your Note to save'
        : state.saved === null
          ? 'Starts after you save a Note'
          : state.saved.status === 'failed'
            ? 'Cognify failed. Your saved Note is safe.'
            : state.saved.cognified_revision === state.saved.revision
              ? state.saved.body_md.trim()
                ? 'Ready for Ask'
                : 'Note cleared'
              : state.saved.status === 'indexing'
                ? 'Cognifying your saved Note…'
                : 'Waiting to Cognify'
  const needsAttention = state.phase === 'conflict' || state.phase === 'error'

  return (
    <div className="space-y-4">
      <Textarea
        id="page-note-body"
        value={state.body}
        maxLength={50000}
        className="page-note-input rounded-lg border-border bg-background p-3"
        placeholder="Write your understanding of this page…"
        onChange={(event) => draft.edit(event.target.value)}
        onBlur={() => void draft.flush()}
      />
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${needsAttention ? 'bg-feedback-developing text-feedback-developing-text' : state.phase === 'saved' && state.saved ? 'bg-feedback-strong text-feedback-strong-text' : 'bg-muted text-muted-foreground'}`}
      >
        <p role="status" className="text-xs font-medium leading-5">
          {saveStatus}
        </p>
        {state.phase !== 'conflict' && state.phase !== 'saved' && (
          <Button
            size="xs"
            variant="outline"
            className="min-h-11 rounded-lg bg-card"
            disabled={state.phase === 'saving'}
            onClick={() => void draft.flush()}
          >
            {state.phase === 'error' ? 'Retry save' : 'Save now'}
          </Button>
        )}
      </div>
      {state.phase === 'conflict' && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Choose which Note to keep</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Use the saved Note to discard this draft, or replace the saved Note
            with your draft.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="outline"
              className="min-h-11 rounded-lg"
              disabled={resolving}
              onClick={() => void resolve(false)}
            >
              Use saved Note
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="min-h-11 rounded-lg"
              disabled={resolving}
              onClick={() => void resolve(true)}
            >
              Replace with my draft
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-1 border-t border-border pt-4">
        <p className="text-xs font-semibold">Cognify</p>
        <p
          role="status"
          className={`text-xs leading-5 ${state.phase === 'saved' && state.saved?.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {cognifyStatus}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          Saving keeps your words. Cognify makes your saved Note available to
          Ask.
        </p>
      </div>
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
