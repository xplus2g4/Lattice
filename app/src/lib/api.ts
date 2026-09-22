/** The API surface the app codes against.
 *
 * The persistent RPC API is the default. Set VITE_USE_MOCK_BACKEND=true
 * explicitly to preview the product with temporary demo data.
 */
import * as backend from './mock-backend'
import { ApiError } from './api-error'
import type {
  AskOut as RpcAskOut,
  AskRequest as RpcAskRequest,
  CourseOut,
  CourseListOut,
  MaterialOut,
  MeOut,
  NoteOut,
  ReadingPositionOut,
  SaveNote,
  SetReadingPosition,
  SessionOut,
  TurnOut,
  UploadOut,
  ValidationError,
  QuizOut,
  QuizAnswerOut,
  RecordAnswer,
  TopicOut,
} from './generated'

export { ApiError } from './api-error'

// The wire types are generated from contracts/openapi.json (ADR 0005); never redeclare them
// here. The view models below normalize RPC records for both the reader and study routes;
// this module also owns the X-User transport and how a FastAPI error becomes an Error.
const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
export const usesMockBackend = () =>
  import.meta.env.VITE_USE_MOCK_BACKEND === 'true'
export type IngestStatus = 'queued' | 'cognifying' | 'ready' | 'failed'
// FastAPI inlines these unions into each field rather than naming them, so name them here.
export type QueryType = NonNullable<RpcAskRequest['query_type']>

// Exhaustive by construction: a query type added to the API fails to compile here until it
// is listed, which a plain `Array<QueryType>` literal would not catch.
const QUERY_TYPE_SET: Record<QueryType, true> = {
  GRAPH_COMPLETION: true,
  RAG_COMPLETION: true,
  HYBRID_COMPLETION: true,
  CHUNKS: true,
}
export const QUERY_TYPES = Object.keys(
  QUERY_TYPE_SET,
) as ReadonlyArray<QueryType>

export interface CourseSummary {
  code: string
  can_delete: boolean
  material_count: number
  note_count: number
  pending_count: number
}
export interface SessionSummary {
  id: string
  created_at: string
  turn_count: number
  first_question: string | null
}
export interface Material {
  course: string
  filename: string
  status: IngestStatus
  error: string | null
  created_at: string
  updated_at: string
}
export interface Note {
  course: string
  owner: string
  id: string
  title: string
  revision?: number
  body_md: string
  status: IngestStatus
  error: string | null
  updated_at: string
}
export type PageNote = Pick<
  NoteOut,
  'id' | 'body_md' | 'revision' | 'cognified_revision' | 'status' | 'error'
>
export interface ReaderMaterial {
  id: string
  filename: string
}
/** The (course, user) pair every call is made within: the caller's enrolment. */
export interface Enrolment {
  course: string
  user: string
}
export interface Citation {
  kind: string
  filename: string | null
  chunk_index: number | null
  relation: string | null
  label: string | null
  chunk_id?: string | null
}
export interface TierResult {
  tier: 'global' | 'private'
  answer: string | null
  citations: Array<Citation>
}
export function describeCitation(c: Citation): string {
  switch (c.kind) {
    case 'chunk':
      return `${c.filename ?? 'Material'}${c.chunk_index !== null ? ` · passage ${c.chunk_index + 1}` : ''}`
    case 'relation':
      return `${c.relation ?? '?'} · relation`
    default:
      return `${c.label ?? '?'} · ${c.kind}`
  }
}
export interface Turn {
  id?: string
  role: 'user' | 'assistant'
  content: string
  query_type: string | null
  results: Array<TierResult>
  used_notes: boolean
  latency_ms: number | null
  created_at: string
}
export interface Session {
  id: string
  course: string
  owner: string
  turns: Array<Turn>
  created_at: string
}
export interface AskRequest {
  question: string
  query_type: QueryType
  session_id?: string | null
}
export interface AskResponse {
  session_id: string
  turn: Turn
}

function formatDetail(status: number, statusText: string, body: unknown) {
  const detail =
    body && typeof body === 'object' && 'detail' in body ? body.detail : body
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return (detail as Array<ValidationError>)
      .map((e) => `${e.loc.join('.')}: ${e.msg}`)
      .join('; ')
  }
  return `${status} ${statusText}`
}

async function fetchResponse(
  user: string,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  headers.set('X-User', user)
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!response.ok) {
    const text = await response.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // non-JSON body; keep the raw text
    }
    throw new ApiError(
      response.status,
      formatDetail(response.status, response.statusText, body),
    )
  }
  return response
}
async function request<T>(
  user: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return (await fetchResponse(user, path, init)).json() as Promise<T>
}
function json(payload: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}
function query(path: string, args: Record<string, string>) {
  return `${path}?${new URLSearchParams(args)}`
}
function ingestStatus(value: string): IngestStatus {
  if (value === 'dirty') return 'queued'
  if (value === 'indexing' || value === 'converting') return 'cognifying'
  return ['queued', 'cognifying', 'ready', 'failed'].includes(value)
    ? (value as IngestStatus)
    : 'failed'
}
function materialView(course: string, row: MaterialOut): Material {
  return {
    course,
    filename: row.filename,
    status: ingestStatus(row.status),
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
function noteView(user: string, course: string, row: NoteOut): Note {
  return {
    course,
    owner: user,
    id: row.id,
    title: row.title,
    revision: row.revision,
    body_md: row.body_md,
    status: ingestStatus(row.status),
    error: row.error,
    updated_at: row.updated_at,
  }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}
function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function turnView(row: TurnOut): Turn {
  const content = row.content_json
  const results: Array<TierResult> = []
  for (const value of Array.isArray(content.results) ? content.results : []) {
    const r = record(value)
    if (r.tier !== 'course' && r.tier !== 'notes') continue
    const citations: Array<Citation> = []
    for (const item of Array.isArray(r.evidence) ? r.evidence : []) {
      const e = record(item)
      const filename = string(e.document_name)
      const relation = string(e.relationship_name)
      const label = string(e.label)
      if (e.kind === 'segment' ? !filename : !relation && !label) continue
      citations.push({
        kind:
          e.kind === 'segment'
            ? 'chunk'
            : e.kind === 'graph_edge'
              ? 'relation'
              : String(e.kind),
        filename,
        chunk_index: typeof e.chunk_index === 'number' ? e.chunk_index : null,
        relation,
        label,
        chunk_id: string(e.chunk_id),
      })
    }
    results.push({
      tier: r.tier === 'course' ? 'global' : 'private',
      answer: string(r.answer),
      citations,
    })
  }
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: string(content.text) ?? '',
    query_type: string(content.query_type),
    results,
    used_notes: row.used_notes,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
  }
}

export async function listCourses(user: string): Promise<Array<CourseSummary>> {
  if (usesMockBackend()) return backend.listCourses(user)
  const rows = await request<Array<CourseListOut>>(user, '/courses.list')
  return Promise.all(
    rows.map(async (row) => {
      const [materials, notes] = await Promise.all([
        listMaterials(user, row.code),
        listNotes(user, row.code),
      ])
      return {
        code: row.code,
        can_delete: row.can_delete,
        material_count: materials.length,
        note_count: notes.length,
        pending_count: [...materials, ...notes].filter(
          (r) => r.status === 'queued' || r.status === 'cognifying',
        ).length,
      }
    }),
  )
}
export async function joinCourse(user: string, course: string): Promise<void> {
  if (usesMockBackend()) return
  try {
    await request(user, '/enrolments.join', json({ course }))
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
    try {
      await request(
        user,
        '/courses.create',
        json({ code: course, name: course.toUpperCase() }),
      )
    } catch (creationError) {
      if (!(creationError instanceof ApiError) || creationError.status !== 409)
        throw creationError
    }
    await request(user, '/enrolments.join', json({ course }))
  }
}
export async function deleteCourse(
  user: string,
  course: string,
): Promise<void> {
  if (usesMockBackend()) return backend.deleteCourse(user, course)
  try {
    await request(user, '/courses.delete', json({ course }))
  } catch (error) {
    // An old local-only course can be removed without creating an API record.
    if (
      !(error instanceof ApiError) ||
      error.status !== 404 ||
      error.message !== 'no such course'
    )
      throw error
  }
}
export async function listSessions(
  user: string,
  course: string,
): Promise<Array<SessionSummary>> {
  if (usesMockBackend()) return backend.listSessions(user, course)
  const rows = await request<Array<SessionOut>>(
    user,
    query('/sessions.list', { course }),
  )
  return rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    turn_count: row.turns.length,
    first_question: string(
      row.turns.find((turn) => turn.role === 'user')?.content_json.text,
    ),
  }))
}
export async function downloadMaterial(
  user: string,
  course: string,
  filename: string,
): Promise<Blob> {
  const material = await getReaderMaterial(user, course, filename)
  return downloadReaderMaterial(user, course, material)
}

export async function getReaderMaterial(
  user: string,
  course: string,
  filename: string,
): Promise<ReaderMaterial> {
  if (usesMockBackend())
    return backend.getReaderMaterial(user, course, filename)
  const rows = await request<Array<MaterialOut>>(
    user,
    query('/materials.list', { course }),
  )
  const row = rows
    .filter((r) => r.filename === filename)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .at(0)
  if (!row) throw new ApiError(404, 'no such material')
  return { id: row.id, filename: row.filename }
}

export async function downloadReaderMaterial(
  user: string,
  course: string,
  material: ReaderMaterial,
): Promise<Blob> {
  if (usesMockBackend())
    return backend.downloadMaterial(user, course, material.filename)
  return (
    await fetchResponse(
      user,
      query('/materials.download', { material: material.id }),
    )
  ).blob()
}

export async function getPageNote(
  user: string,
  material: string,
  page: number,
) {
  if (usesMockBackend()) return backend.getPageNote(user, material, page)
  return request<PageNote | null>(
    user,
    query('/notes.get', { material, page: String(page) }),
  )
}

export async function savePageNote(
  user: string,
  course: string,
  material: string,
  page: number,
  body_md: string,
  expected_revision: number,
): Promise<PageNote> {
  if (usesMockBackend())
    return backend.savePageNote(
      user,
      course,
      material,
      page,
      body_md,
      expected_revision,
    )
  const body: SaveNote = { course, material, page, body_md, expected_revision }
  return request<NoteOut>(user, '/notes.save', json(body))
}

export async function getReadingPosition(user: string, material: string) {
  if (usesMockBackend()) return backend.getReadingPosition(user, material)
  const position = await request<ReadingPositionOut | null>(
    user,
    query('/readingPosition.get', { material }),
  )
  return position?.page ?? 1
}

export async function saveReadingPosition(
  user: string,
  material: string,
  page: number,
) {
  if (usesMockBackend())
    return backend.saveReadingPosition(user, material, page)
  const body: SetReadingPosition = { material, page }
  return request<ReadingPositionOut>(user, '/readingPosition.set', json(body))
}

export async function notesCognifyEnabled(user: string) {
  if (usesMockBackend()) return true
  const me = await request<MeOut>(user, '/me.get')
  return !me.user.notes_opt_out
}
export async function listMaterials(
  user: string,
  course: string,
): Promise<Array<Material>> {
  if (usesMockBackend()) return backend.listMaterials(user, course)
  const rows = await request<Array<MaterialOut>>(
    user,
    query('/materials.list', { course }),
  )
  return rows.map((row) => materialView(course, row))
}
export async function uploadMaterial(
  user: string,
  course: string,
  file: File,
): Promise<Material> {
  if (usesMockBackend()) return backend.uploadMaterial(user, course, file)
  const form = new FormData()
  form.append('course', course)
  form.append('file', file)
  const upload = () =>
    request<UploadOut>(user, '/materials.upload', {
      method: 'POST',
      body: form,
    })
  let saved: UploadOut
  try {
    saved = await upload()
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 404 ||
      error.message !== 'no such course'
    )
      throw error
    await joinCourse(user, course)
    saved = await upload()
  }
  return materialView(course, saved.material)
}
export async function listNotes(
  user: string,
  course: string,
): Promise<Array<Note>> {
  if (usesMockBackend()) return backend.listNotes(user, course)
  const rows = await request<Array<NoteOut>>(
    user,
    query('/notes.list', { course }),
  )
  return rows.map((row) => noteView(user, course, row))
}
export async function saveNote(
  user: string,
  course: string,
  id: string,
  body_md: string,
  title?: string,
  expected_revision?: number,
): Promise<Note> {
  if (usesMockBackend())
    return backend.saveNote(user, course, id, body_md, title)
  const note =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
      ? id
      : undefined
  return noteView(
    user,
    course,
    await request<NoteOut>(
      user,
      '/notes.save',
      json({
        course,
        note,
        body_md,
        title,
        expected_revision,
      } satisfies SaveNote),
    ),
  )
}
export async function renameNote(
  user: string,
  course: string,
  id: string,
  title: string,
): Promise<Note> {
  if (usesMockBackend()) return backend.renameNote(user, course, id, title)
  return noteView(
    user,
    course,
    await request<NoteOut>(user, '/notes.rename', json({ note: id, title })),
  )
}
export async function ask(
  user: string,
  course: string,
  req: AskRequest,
): Promise<AskResponse> {
  if (usesMockBackend()) return backend.ask(user, course, req)
  const body: RpcAskRequest = {
    course,
    question: req.question,
    query_type: req.query_type,
    session: req.session_id,
  }
  const answer = await request<RpcAskOut>(user, '/ask', json(body))
  return { session_id: answer.session, turn: turnView(answer.turn) }
}
export async function getSession(
  user: string,
  course: string,
  id: string,
): Promise<Session> {
  if (usesMockBackend()) return backend.getSession(user, course, id)
  const [row, scope] = await Promise.all([
    request<SessionOut>(user, query('/sessions.get', { session: id })),
    request<CourseOut>(user, query('/courses.get', { course })),
  ])
  if (row.course_id !== scope.id) throw new ApiError(404, 'no such session')
  return {
    id: row.id,
    course,
    owner: user,
    created_at: row.created_at,
    turns: row.turns.map(turnView),
  }
}

// Quiz generation and grading have no API yet. These calls only operate on
// existing records; the client must never invent questions or correctness.
export async function listQuizzes(user: string, course: string) {
  if (usesMockBackend()) return []
  return request<Array<QuizOut>>(user, query('/quizzes.list', { course }))
}

export async function getQuiz(user: string, course: string, quiz: string) {
  const [row, enrolledCourse] = await Promise.all([
    request<QuizOut>(user, query('/quizzes.get', { quiz })),
    request<CourseOut>(user, query('/courses.get', { course })),
  ])
  if (row.course_id !== enrolledCourse.id)
    throw new ApiError(404, 'no such quiz in this course')
  return row
}

export async function quizMaterials(user: string, course: string) {
  if (usesMockBackend()) return []
  return request<Array<MaterialOut>>(user, query('/materials.list', { course }))
}

export async function listTopics(user: string, material: string) {
  if (usesMockBackend()) return []
  return request<Array<TopicOut>>(user, query('/topics.list', { material }))
}

export function recordQuizAnswer(
  user: string,
  question: string,
  answer: string,
) {
  const body: RecordAnswer = { question, answer_text: answer }
  return request<QuizAnswerOut>(user, '/quizAnswers.record', json(body))
}

export function closeQuiz(
  user: string,
  quiz: string,
  status: 'submit' | 'abandon',
) {
  return request<QuizOut>(user, `/quizzes.${status}`, json({ quiz }))
}

/** react-query refetchInterval helper: poll while anything is still ingesting. */
export function pollWhilePending<T extends { status: IngestStatus }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => i.status === 'queued' || i.status === 'cognifying')
    ? 2000
    : false
}
