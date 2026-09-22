import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api-error'
import { PageNoteDraft } from './page-note-draft'
import type { PageNote } from './api'

const note = (body: string, revision = 1): PageNote => ({
  id: 'note',
  body_md: body,
  revision,
  cognified_revision: 0,
  status: 'dirty',
  error: null,
})
afterEach(() => vi.useRealTimers())

describe('Page Note autosave', () => {
  it('coalesces typing and saves after the quiet interval', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (body: string, revision: number) =>
      note(body, revision + 1),
    )
    const draft = new PageNoteDraft('draft', null, save, vi.fn())
    draft.edit('first')
    await vi.advanceTimersByTimeAsync(500)
    draft.edit('finished')
    await vi.advanceTimersByTimeAsync(699)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('finished', 0)
    expect(draft.snapshot().phase).toBe('saved')
  })

  it('serializes edits made during a save using the returned revision', async () => {
    let finish!: (value: PageNote) => void
    const save = vi
      .fn<(body: string, revision: number) => Promise<PageNote>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockImplementation(async (body, revision) => note(body, revision + 1))
    const draft = new PageNoteDraft('draft', null, save, vi.fn())
    draft.edit('first')
    const pending = draft.flush()
    draft.edit('newer text')
    void draft.flush()
    expect(save).toHaveBeenCalledTimes(1)
    finish(note('first'))
    await pending
    expect(save.mock.calls).toEqual([
      ['first', 0],
      ['newer text', 1],
    ])
    expect(draft.snapshot().saved?.body_md).toBe('newer text')
    expect(sessionStorage.getItem('draft')).toBeNull()
  })

  it('persists an empty edit so clearing a Note removes its content', async () => {
    const save = vi.fn(async (body: string, revision: number) =>
      note(body, revision + 1),
    )
    const draft = new PageNoteDraft('draft', note('old'), save, vi.fn())
    draft.edit('')
    await draft.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith('', 1)
    expect(draft.snapshot().phase).toBe('saved')
  })

  it('retains a reverted draft while an earlier edit is still being saved', async () => {
    let finish!: (value: PageNote) => void
    const save = vi
      .fn<(body: string, revision: number) => Promise<PageNote>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockImplementation(async (body, revision) => note(body, revision + 1))
    const draft = new PageNoteDraft('draft', note('original'), save, vi.fn())
    draft.edit('temporary edit')
    const pending = draft.flush()
    draft.edit('original')
    expect(JSON.parse(sessionStorage.getItem('draft') ?? '{}').body).toBe(
      'original',
    )
    finish(note('temporary edit', 2))
    await pending
    expect(draft.snapshot().saved?.body_md).toBe('original')
    expect(sessionStorage.getItem('draft')).toBeNull()
  })

  it('recovers a failed save after reload without losing the draft', async () => {
    const draft = new PageNoteDraft(
      'draft',
      note('old'),
      async () => {
        throw new Error('offline')
      },
      vi.fn(),
    )
    draft.edit('precious text')
    await draft.flush()
    expect(draft.snapshot().phase).toBe('error')
    const save = vi.fn(async (body: string, revision: number) =>
      note(body, revision + 1),
    )
    const restored = new PageNoteDraft('draft', note('old'), save, vi.fn())
    expect(restored.snapshot().body).toBe('precious text')
    await restored.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith('precious text', 1)
    expect(sessionStorage.getItem('draft')).toBeNull()
  })

  it('requires an explicit choice after a conflict, including another reload', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(409, 'changed elsewhere')
    })
    const draft = new PageNoteDraft('draft', note('old'), save, vi.fn())
    draft.edit('mine')
    await draft.flush()
    await draft.flush()
    expect(save).toHaveBeenCalledTimes(1)
    const restored = new PageNoteDraft(
      'draft',
      note('theirs', 2),
      save,
      vi.fn(),
    )
    restored.edit('mine, improved')
    await restored.flush()
    const again = new PageNoteDraft('draft', note('theirs', 2), save, vi.fn())
    expect(again.snapshot().phase).toBe('conflict')
    expect(again.snapshot().body).toBe('mine, improved')
    again.resolve(note('theirs', 2), false)
    await again.flush()
    expect(again.snapshot().body).toBe('theirs')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not replace unsaved text with a background refresh', async () => {
    const draft = new PageNoteDraft(
      'draft',
      note('old'),
      async (body, revision) => note(body, revision + 1),
      vi.fn(),
    )
    draft.edit('mine')
    draft.observe(note('theirs', 2))
    expect(draft.snapshot().body).toBe('mine')
    await draft.flush()
  })
})
