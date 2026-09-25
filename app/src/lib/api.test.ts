import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  ApiError,
  abandonGrill,
  extendGrill,
  generateGrill,
  gradeGrill,
  listMaterials,
  listNotes,
  saveNote,
  uploadNote,
} from '#/lib/api'
import { note } from '#/test/fixtures'
import { resetStore } from '#/test/handlers'
import { server } from '#/test/server'

// The stubbed session is alice@example.com (see test/setup.ts): Bearer test-token
// is who the mock handlers see, so `owner` and the per-user filters pin to her.
describe('caller identity', () => {
  it('sends every Grill request with session authentication and its RPC payload', async () => {
    const received: Array<{
      path: string
      authorization: string | null
      legacyIdentity: string | null
      body: unknown
    }> = []
    server.use(
      http.post('*/quizzes.*', async ({ request }) => {
        received.push({
          path: new URL(request.url).pathname,
          authorization: request.headers.get('Authorization'),
          legacyIdentity: request.headers.get('X-User'),
          body: await request.clone().json(),
        })
      }),
    )

    const plan = await generateGrill('cs101', 'm-week1.pdf')
    const questions = await extendGrill(plan.grill.id, 0)
    const answers = [{ question: questions[0].id, answer_text: 'Chaining' }]
    const result = await gradeGrill(plan.grill.id, answers)
    const next = await generateGrill('cs101', 'm-week1.pdf')
    await abandonGrill(next.grill.id)

    expect(result.grill.status).toBe('submitted')
    expect(received).toEqual(
      [
        {
          path: '/quizzes.generate',
          body: { course: 'cs101', material: 'm-week1.pdf' },
        },
        { path: '/quizzes.extend', body: { quiz: plan.grill.id, batch: 0 } },
        { path: '/quizzes.grade', body: { quiz: plan.grill.id, answers } },
        {
          path: '/quizzes.generate',
          body: { course: 'cs101', material: 'm-week1.pdf' },
        },
        { path: '/quizzes.abandon', body: { quiz: next.grill.id } },
      ].map((request) => ({
        ...request,
        authorization: 'Bearer test-token',
        legacyIdentity: null,
      })),
    )
  })

  it('reads back only the calling user\u2019s notes', async () => {
    resetStore({
      notes: [
        note({ owner: 'alice@example.com', id: 'alice-note' }),
        note({ owner: 'bob@example.com', id: 'bob-note' }),
      ],
    })

    const mine = await listNotes('cs101')

    expect(mine.map((n) => n.id)).toEqual(['alice-note'])
  })

  it('saves a note as the calling user', async () => {
    const saved = await saveNote('cs101', 'n7', 'my note')

    expect(saved.owner).toBe('alice@example.com')
    expect(saved.body_md).toBe('my note')
  })

  it('uploads a PDF as a Note of the calling user', async () => {
    const saved = await uploadNote(
      'cs101',
      new File(['%PDF'], 'summary.pdf', { type: 'application/pdf' }),
    )

    expect(saved.owner).toBe('alice@example.com')
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

    await expect(listMaterials('cs101')).rejects.toThrow(
      'not enrolled in cs101',
    )
  })

  it('carries the status code so callers can branch on it', async () => {
    server.use(
      http.get('*/materials.list', () =>
        HttpResponse.json({ detail: 'nope' }, { status: 403 }),
      ),
    )

    const error = await listMaterials('cs101').catch((e: unknown) => e)

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

    await expect(listMaterials('cs101')).rejects.toThrow(
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

    await expect(listMaterials('cs101')).rejects.toThrow(
      '<html>502 Bad Gateway</html>',
    )
  })
})
