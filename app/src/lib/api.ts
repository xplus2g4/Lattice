/** The API surface the app codes against.
 *
 * Every call is served by `#/lib/http-backend` against the running API; the
 * session cookie carries identity, so `user` arguments only key caches and
 * fills. `VITE_MOCK_API=1` swaps in `#/lib/mock-backend` to run the shell
 * without a server behind it.
 */
import * as httpBackend from './http-backend'
import * as mockBackend from './mock-backend'

const backend =
  import.meta.env.VITE_MOCK_API === '1' ? mockBackend : httpBackend

export { ApiError } from './api-error'

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

export function listCourses(user: string) {
  return backend.listCourses(user)
}

/** Enrol in a course by code, creating it (owned by the caller) when it does
 * not exist yet — the "add a course" flow on the home screen. */
export function joinCourse(user: string, code: string) {
  return backend.joinCourse(user, code)
}

export function listSessions(user: string, course: string) {
  return backend.listSessions(user, course)
}

export function downloadMaterial(
  user: string,
  course: string,
  filename: string,
) {
  return backend.downloadMaterial(user, course, filename)
}

export function listMaterials(user: string, course: string) {
  return backend.listMaterials(user, course)
}

export function uploadMaterial(user: string, course: string, file: File) {
  return backend.uploadMaterial(user, course, file)
}

export function listNotes(user: string, course: string) {
  return backend.listNotes(user, course)
}

/** `id` is the server uuid of an existing Note; null writes a fresh one. */
export function saveNote(
  user: string,
  course: string,
  id: string | null,
  body_md: string,
) {
  return backend.saveNote(user, course, id, body_md)
}

export function ask(user: string, course: string, req: AskRequest) {
  return backend.ask(user, course, req)
}

export function getSession(user: string, course: string, id: string) {
  return backend.getSession(user, course, id)
}

/** react-query refetchInterval helper: poll while anything is still ingesting. */
export function pollWhilePending<T extends { status: IngestStatus }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => i.status === 'queued' || i.status === 'cognifying')
    ? 2000
    : false
}
