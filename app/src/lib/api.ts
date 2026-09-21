const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type IngestStatus =
  'queued' | 'converting' | 'cognifying' | 'ready' | 'failed'

export type NoteStatus = 'dirty' | 'indexing' | 'ready' | 'failed'

export type QueryType =
  'GRAPH_COMPLETION' | 'RAG_COMPLETION' | 'HYBRID_COMPLETION' | 'CHUNKS'

export const QUERY_TYPES: ReadonlyArray<QueryType> = [
  'GRAPH_COMPLETION',
  'RAG_COMPLETION',
  'HYBRID_COMPLETION',
  'CHUNKS',
]

export interface Course {
  id: string
  code: string
  name: string
  term: string | null
  owner_user_id: string
  global_dataset_name: string
  created_at: string
}

export interface Material {
  id: string
  course_id: string
  title: string
  filename: string
  week: number | null
  lecture_no: number | null
  kind: string | null
  page_count: number | null
  sha256: string
  status: IngestStatus
  error: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Upload {
  material: Material
  deduplicated: boolean
}

export interface Note {
  id: string
  course_id: string
  material_id: string | null
  page: number | null
  body_md: string
  status: NoteStatus
  error: string | null
  created_at: string
  updated_at: string
}

export interface Evidence {
  kind: string
  dataset_id: string | null
  data_id: string | null
  chunk_id: string | null
  chunk_index: number | null
  document_name: string | null
  label: string | null
  relationship_name: string | null
}

export interface TierResult {
  tier: 'course' | 'notes'
  dataset_name: string
  answer: string | null
  evidence: Array<Evidence>
}

/** What a Turn says: the text, and for an answer the Tier results behind it. */
export interface TurnContent {
  text: string
  query_type: string | null
  results?: Array<TierResult>
}

export interface Turn {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content_json: TurnContent
  cited_chunk_ids: Array<string>
  used_notes: boolean
  latency_ms: number | null
  created_at: string
}

export interface Session {
  id: string
  course_id: string
  turns: Array<Turn>
  created_at: string
  last_turn_at: string
}

export interface AskRequest {
  question: string
  query_type: QueryType
  session?: string | null
}

export interface AskResponse {
  session: string
  turn: Turn
}

/** Non-2xx response; `message` is the server's `detail`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

interface ValidationError {
  loc: Array<string | number>
  msg: string
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

async function request<T>(
  user: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-User', user)
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // non-JSON body; keep the raw text
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      formatDetail(res.status, res.statusText, body),
    )
  }
  return body as T
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function query(args: Record<string, string>) {
  return `?${new URLSearchParams(args).toString()}`
}

export function joinCourse(user: string, course: string) {
  return request<unknown>(user, '/enrolments.join', json('POST', { course }))
}

export function createCourse(user: string, code: string, name: string) {
  return request<Course>(user, '/courses.create', json('POST', { code, name }))
}

export function listMaterials(user: string, course: string) {
  return request<Array<Material>>(user, `/materials.list${query({ course })}`)
}

export function uploadMaterial(user: string, course: string, file: File) {
  const form = new FormData()
  form.append('course', course)
  form.append('file', file)
  return request<Upload>(user, '/materials.upload', {
    method: 'POST',
    body: form,
  })
}

export function listNotes(user: string, course: string) {
  return request<Array<Note>>(user, `/notes.list${query({ course })}`)
}

export function saveNote(
  user: string,
  course: string,
  body_md: string,
  note?: string,
) {
  return request<Note>(
    user,
    '/notes.save',
    json('POST', { course, body_md, note }),
  )
}

export function ask(user: string, course: string, req: AskRequest) {
  return request<AskResponse>(user, '/ask', json('POST', { course, ...req }))
}

export function getSession(user: string, session: string) {
  return request<Session>(user, `/sessions.get${query({ session })}`)
}

export function rateTurn(
  user: string,
  turn: string,
  rating: 1 | -1,
  comment?: string,
) {
  return request<{ rating: number }>(
    user,
    '/feedback.record',
    json('POST', { turn, rating, comment }),
  )
}
