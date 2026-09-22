import { ApiError } from './api-error'
import type { PageNote } from './api'

type Phase = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
interface Snapshot {
  body: string
  saved: PageNote | null
  phase: Phase
  error: string | null
  recoverable: boolean
}
type Save = (body: string, revision: number) => Promise<PageNote>

// One controller per caller/Material/Page and QueryClient. Navigation cannot start a
// second writer while the previous editor is still saving. Draft text survives reload
// in this tab; API records remain the durable copy across browser sessions.
const drafts = new WeakMap<object, Map<string, PageNoteDraft>>()
export function pageNoteDraft(
  owner: object,
  key: string,
  initial: PageNote | null,
  save: Save,
  onSaved: (note: PageNote) => void,
) {
  let entries = drafts.get(owner)
  if (!entries) {
    entries = new Map()
    drafts.set(owner, entries)
  }
  let draft = entries.get(key)
  if (!draft) {
    draft = new PageNoteDraft(key, initial, save, onSaved)
    entries.set(key, draft)
  }
  return draft
}

export class PageNoteDraft {
  private state: Snapshot
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private revision: number
  private warnBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ''
  }

  constructor(
    private key: string,
    initial: PageNote | null,
    private save: Save,
    private onSaved: (note: PageNote) => void,
  ) {
    this.revision = initial?.revision ?? 0
    this.state = {
      body: initial?.body_md ?? '',
      saved: initial,
      phase: 'saved',
      error: null,
      recoverable: true,
    }
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const recovered = JSON.parse(raw) as {
          body?: unknown
          revision?: unknown
        }
        if (
          typeof recovered.body === 'string' &&
          typeof recovered.revision === 'number' &&
          recovered.body !== this.state.body
        ) {
          this.revision = recovered.revision
          this.state = {
            ...this.state,
            body: recovered.body,
            phase:
              recovered.revision === (initial?.revision ?? 0)
                ? 'unsaved'
                : 'conflict',
            error: null,
          }
        }
      }
    } catch {
      this.state.recoverable = false
    }
    if (this.state.phase !== 'saved')
      window.addEventListener('beforeunload', this.warnBeforeUnload)
  }

  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(next: Partial<Snapshot>) {
    this.state = { ...this.state, ...next }
    // Keep the warning active even after navigating away from a failed Page save.
    if (this.state.phase === 'saved')
      window.removeEventListener('beforeunload', this.warnBeforeUnload)
    else window.addEventListener('beforeunload', this.warnBeforeUnload)
    this.listeners.forEach((listener) => listener())
  }
  private remember() {
    try {
      if (
        this.state.body === (this.state.saved?.body_md ?? '') &&
        (!this.running || this.state.phase === 'saved')
      )
        sessionStorage.removeItem(this.key)
      else
        sessionStorage.setItem(
          this.key,
          JSON.stringify({ body: this.state.body, revision: this.revision }),
        )
    } catch {
      this.publish({ recoverable: false })
    }
  }
  edit = (body: string) => {
    this.publish({
      body,
      phase:
        this.state.phase === 'conflict'
          ? 'conflict'
          : this.running
            ? 'saving'
            : 'unsaved',
      error: null,
    })
    this.remember()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush()
    }, 700)
  }
  observe(note: PageNote | null) {
    if (
      this.state.phase !== 'saved' ||
      (note?.revision ?? 0) < (this.state.saved?.revision ?? 0)
    )
      return
    this.revision = note?.revision ?? 0
    this.publish({ saved: note, body: note?.body_md ?? '' })
  }
  resolve(note: PageNote | null, keepDraft: boolean) {
    this.revision = note?.revision ?? 0
    this.publish({
      saved: note,
      body: keepDraft ? this.state.body : (note?.body_md ?? ''),
      phase: 'unsaved',
      error: null,
    })
    this.remember()
    void this.flush()
  }
  flush = (): Promise<void> => {
    clearTimeout(this.timer)
    if (this.running) return this.running
    if (this.state.phase === 'conflict') return Promise.resolve()
    this.running = this.persist().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async persist() {
    while (this.state.body !== (this.state.saved?.body_md ?? '')) {
      const body = this.state.body
      const revision = this.revision
      this.publish({ phase: 'saving', error: null })
      try {
        const saved = await this.save(body, revision)
        this.revision = saved.revision
        this.publish({ saved })
        this.remember()
        this.onSaved(saved)
      } catch (error) {
        clearTimeout(this.timer)
        this.publish({
          phase:
            error instanceof ApiError && error.status === 409
              ? 'conflict'
              : 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Could not save your Note.',
        })
        return
      }
    }
    clearTimeout(this.timer)
    this.publish({ phase: 'saved', error: null })
    this.remember()
  }
}
