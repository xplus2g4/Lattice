import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  ApiError,
  listMaterials,
  listNotes,
  saveNote,
  uploadNote,
} from '#/lib/api'
import { note } from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { server } from '#/test/server'

describe('caller identity', () => {
  it('reads back only the calling user\u2019s notes', async () => {
    resetStore({
      notes: [
        note({ owner: 'alice@example.com', id: 'alice-note' }),
        note({ owner: 'bob@example.com', id: 'bob-note' }),
      ],
    })

    const mine = await listNotes('alice@example.com', 'cs101')

    expect(mine.map((n) => n.id)).toEqual(['alice-note'])
  })

  it('saves a note as the calling user', async () => {
    const saved = await saveNote('bob@example.com', 'cs101', 'n7', 'my note')

    expect(saved.owner).toBe('bob@example.com')
    expect(saved.body_md).toBe('my note')
  })

  it('uploads a PDF as a Note of the calling user', async () => {
    const saved = await uploadNote(
      'bob@example.com',
      'cs101',
      new File(['%PDF'], 'summary.pdf', { type: 'application/pdf' }),
    )

    expect(saved.owner).toBe('bob@example.com')
    expect(saved.filename).toBe('summary.pdf')
    expect(saved.body_md).toBe('')
  })
})

describe('reporting an API error', () => {
  it('surfaces the detail the API sent', async () => {
    server.use(
      http.get('*/materials.list', () =>
        HttpResponse.json({ detail: 'not enrolled in cs101' }, { status: 403 }),
      ),
    )

    await expect(listMaterials('alice@example.com', 'cs101')).rejects.toThrow(
      'not enrolled in cs101',
    )
  })

  it('carries the status code so callers can branch on it', async () => {
    server.use(
      http.get('*/materials.list', () =>
        HttpResponse.json({ detail: 'nope' }, { status: 403 }),
      ),
    )

    const error = await listMaterials('alice@example.com', 'cs101').catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
  })

  it('flattens a FastAPI validation error into one readable line', async () => {
    server.use(
      http.get('*/materials.list', () =>
        HttpResponse.json(
          {
            detail: [
              {
                loc: ['body', 'question'],
                msg: 'Field required',
                type: 'missing',
              },
              {
                loc: ['body', 'course'],
                msg: 'Too short',
                type: 'value_error',
              },
            ],
          },
          { status: 422 },
        ),
      ),
    )

    await expect(listMaterials('alice@example.com', 'cs101')).rejects.toThrow(
      'body.question: Field required; body.course: Too short',
    )
  })

  it('falls back to the raw body when the API did not send JSON', async () => {
    server.use(
      http.get(
        '*/materials.list',
        () => new HttpResponse('<html>502 Bad Gateway</html>', { status: 502 }),
      ),
    )

    await expect(listMaterials('alice@example.com', 'cs101')).rejects.toThrow(
      '<html>502 Bad Gateway</html>',
    )
  })
})
