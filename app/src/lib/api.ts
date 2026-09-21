const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type IngestStatus = 'queued' | 'cognifying' | 'ready' | 'failed'

export type QueryType =
  'GRAPH_COMPLETION' | 'RAG_COMPLETION' | 'HYBRID_COMPLETION' | 'CHUNKS'

export const QUERY_TYPES: ReadonlyArray<QueryType> = [
  'GRAPH_COMPLETION',
  'RAG_COMPLETION',
  'HYBRID_COMPLETION',
  'CHUNKS',
]

export interface CourseSummary {
  code: string
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
  body_md: string
  status: IngestStatus
  error: string | null
  updated_at: string
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
}

export interface TierResult {
  tier: 'global' | 'private'
  answer: string | null
  citations: Array<Citation>
}

export function describeCitation(c: Citation): string {
  switch (c.kind) {
    case 'chunk':
      return `${c.filename ?? '?'}${c.chunk_index !== null ? ` #${c.chunk_index}` : ''}`
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

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // non-JSON body; keep the raw text
  }
  throw new ApiError(res.status, formatDetail(res.status, res.statusText, body))
}

async function request<T>(
  user: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-User', user)
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  await assertOk(res)
  const text = await res.text()
  try {
    return (text ? JSON.parse(text) : null) as T
  } catch {
    return text as T
  }
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

export function listCourses(user: string) {
  return request<Array<CourseSummary>>(user, '/courses')
}

export function listSessions(user: string, course: string) {
  return request<Array<SessionSummary>>(user, `/courses/${course}/sessions`)
}

/** Raw download: the file endpoint needs the X-User header, so no plain <a href>. */
export async function downloadMaterial(
  user: string,
  course: string,
  filename: string,
): Promise<Blob> {
  const res = await fetch(
    `${API_URL}/courses/${course}/materials/${encodeURIComponent(filename)}`,
    { headers: { 'X-User': user } },
  )
  await assertOk(res)
  return res.blob()
}

export function listMaterials(user: string, course: string) {
  return request<Array<Material>>(user, `/courses/${course}/materials`)
}

export function uploadMaterial(user: string, course: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<Material>(user, `/courses/${course}/materials`, {
    method: 'POST',
    body: form,
  })
}

export function listNotes(user: string, course: string) {
  return request<Array<Note>>(user, `/courses/${course}/notes`)
}

export function saveNote(
  user: string,
  course: string,
  id: string,
  body_md: string,
) {
  return request<Note>(
    user,
    `/courses/${course}/notes/${encodeURIComponent(id)}`,
    json('PUT', { body_md }),
  )
}

export function ask(user: string, course: string, req: AskRequest) {
  return request<AskResponse>(user, `/courses/${course}/ask`, json('POST', req))
}

export function getSession(user: string, course: string, id: string) {
  return request<Session>(
    user,
    `/courses/${course}/sessions/${encodeURIComponent(id)}`,
  )
}

/** react-query refetchInterval helper: poll while anything is still ingesting. */
export function pollWhilePending<T extends { status: IngestStatus }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => i.status === 'queued' || i.status === 'cognifying')
    ? 2000
    : false
}
