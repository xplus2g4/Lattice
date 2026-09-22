import { HttpResponse, http } from 'msw'
import { server } from './server'
import type {
  MeOut,
  NoteOut,
  ReadingPositionOut,
  SaveNote,
  SetReadingPosition,
} from '#/lib/generated'

export const READER_MATERIAL = '11111111-1111-4111-8111-111111111111'
export function readerNote(body: string, page = 1, revision = 1): NoteOut {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    course_id: '33333333-3333-4333-8333-333333333333',
    material_id: READER_MATERIAL,
    page,
    body_md: body,
    title: 'Untitled Note',
    revision,
    cognified_revision: revision,
    status: 'ready',
    error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

export function installReaderHandlers() {
  const notes = new Map<string, NoteOut>()
  const positions = new Map<string, number>()
  const writes: Array<SaveNote & { user: string }> = []
  const key = (user: string, material: string, page: number) =>
    JSON.stringify([user, material, page])
  server.use(
    http.get('*/me.get', () =>
      HttpResponse.json({
        user: {
          id: 'u1',
          email: 'alice@example.com',
          name: null,
          role: 'student',
          notes_opt_out: false,
          created_at: '2026-01-01T00:00:00Z',
        },
        courses: [],
      } satisfies MeOut),
    ),
    http.get('*/notes.get', ({ request }) => {
      const params = new URL(request.url).searchParams
      return HttpResponse.json(
        notes.get(
          key(
            request.headers.get('X-User') ?? '',
            params.get('material') ?? '',
            Number(params.get('page')),
          ),
        ) ?? null,
      )
    }),
    http.post('*/notes.save', async ({ request }) => {
      const body = (await request.json()) as SaveNote
      const user = request.headers.get('X-User') ?? ''
      writes.push({ ...body, user })
      const id = key(user, body.material ?? '', body.page ?? 1)
      const previous = notes.get(id)
      if ((previous?.revision ?? 0) !== body.expected_revision)
        return HttpResponse.json(
          { detail: 'Note changed; read its current revision before editing' },
          { status: 409 },
        )
      const saved = {
        ...readerNote(
          body.body_md,
          body.page ?? 1,
          (previous?.revision ?? 0) + 1,
        ),
        material_id: body.material ?? null,
      }
      notes.set(id, saved)
      return HttpResponse.json(saved, { status: 202 })
    }),
    http.get('*/readingPosition.get', ({ request }) => {
      const material = new URL(request.url).searchParams.get('material') ?? ''
      const page = positions.get(
        key(request.headers.get('X-User') ?? '', material, 0),
      )
      return HttpResponse.json(
        page
          ? ({
              material_id: material,
              page,
              updated_at: '2026-01-01T00:00:00Z',
            } satisfies ReadingPositionOut)
          : null,
      )
    }),
    http.post('*/readingPosition.set', async ({ request }) => {
      const { material, page } = (await request.json()) as SetReadingPosition
      positions.set(key(request.headers.get('X-User') ?? '', material, 0), page)
      return HttpResponse.json({
        material_id: material,
        page,
        updated_at: '2026-01-01T00:00:00Z',
      } satisfies ReadingPositionOut)
    }),
  )
  return { notes, positions, writes, key }
}
