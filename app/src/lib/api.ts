/** The API surface the app codes against: the persistent RPC API. */
import { ApiError } from './api-error'
import { apiToken, clearApiTokenCache, getSessionUser } from './auth'
import type {
  AskOut as RpcAskOut,
  AskRequest as RpcAskRequest,
  CourseOut,
  InviteOut,
  MaterialOut,
  MeOut,
  NoteOut,
  NoteUploadOut,
  SessionOut,
  TurnOut,
  UploadOut,
  ValidationError,
} from './generated'

export { ApiError } from './api-error'

// The wire types are generated from contracts/openapi.json (ADR 0005); never redeclare them
// here. The view models below normalize RPC records for both the reader and study routes;
// this module also owns the Bearer transport and how a FastAPI error becomes an Error.
const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
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
  /** Also the name Cognee knows the Material by, so citations carry it. */
  sha256: string
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
  /** Set when the Note is an uploaded PDF; then body_md is empty. */
  filename: string | null
  /** Also the name Cognee knows a PDF Note by, so citations carry it. */
  sha256: string | null
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
  chunk_id?: string | null
  /** Approximate Pages the chunk covers, read from the loader's page labels. */
  page_start?: number | null
  page_end?: number | null
}
export interface TierResult {
  tier: 'global' | 'private'
  answer: string | null
  citations: Array<Citation>
}
export function describeCitation(c: Citation): string {
  switch (c.kind) {
    case 'chunk':
      return `${c.filename ?? '?'}${
        c.page_start != null
          ? ` · ${describePages(c)}`
          : c.chunk_index !== null
            ? ` #${c.chunk_index}`
            : ''
      }`
    case 'relation':
      return `${c.relation ?? '?'} · relation`
    default:
      return `${c.label ?? '?'} · ${c.kind}`
  }
}
export function describePages(
  c: Pick<Citation, 'page_start' | 'page_end'>,
): string {
  if (c.page_start == null) return ''
  const end = c.page_end ?? c.page_start
  return end > c.page_start ? `p. ${c.page_start}–${end}` : `p. ${c.page_start}`
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

/** The caller's email for `owner` fields, cached once the session is known. */
let sessionEmail: string | null = null
async function meEmail(): Promise<string> {
  sessionEmail ??= (await getSessionUser())?.email ?? ''
  return sessionEmail
}

async function authedFetch(path: string, init: RequestInit) {
  const send = async () => {
    const headers = new Headers(init.headers)
    const token = await apiToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(`${API_URL}${path}`, { ...init, headers })
  }
  let response = await send()
  // A 401 can be an expired cached token: re-mint once before failing.
  if (response.status === 401) {
    clearApiTokenCache()
    response = await send()
  }
  return response
}

async function fetchResponse(path: string, init: RequestInit = {}) {
  const response = await authedFetch(path, init)
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
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await fetchResponse(path, init)).json() as Promise<T>
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
    sha256: row.sha256,
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
    body_md: row.body_md,
    filename: row.filename,
    sha256: row.sha256,
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
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}
const EVIDENCE_BLOCK = /\n\nEvidence:\n((?:- chunk [^\n]*(?:\n|$))+)$/
const EVIDENCE_LINE =
  /^- chunk (\d+|unknown) of document (.+?)(?: \(([^)]*)\))?(?:: "(.*)")?$/

/** Cognee can end an answer with a text Evidence block naming chunk ids. Lift it into
 * Citations so the reader sees Page badges instead of ids. */
function liftEvidence(answer: string | null): {
  answer: string | null
  citations: Array<Citation>
} {
  const block = answer?.match(EVIDENCE_BLOCK)
  if (!answer || !block) return { answer, citations: [] }
  const citations: Array<Citation> = []
  for (const line of block[1].trim().split('\n')) {
    const m = line.match(EVIDENCE_LINE)
    if (!m) continue
    const [, number, filename, ids = '', snippet = ''] = m
    const page = positive(Number(snippet.match(/^Page (\d+):/)?.[1]))
    citations.push({
      kind: 'chunk',
      filename,
      chunk_index: number === 'unknown' ? null : Number(number) - 1,
      relation: null,
      label: null,
      chunk_id: ids.match(/chunk_id: ([^,\s]+)/)?.[1] ?? null,
      page_start: page,
      page_end: page,
    })
  }
  return { answer: answer.slice(0, block.index), citations }
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
        page_start: positive(e.page_start),
        page_end: positive(e.page_end),
      })
    }
    const lifted = liftEvidence(string(r.answer))
    const cited = new Set(citations.map((c) => c.chunk_id).filter(Boolean))
    results.push({
      tier: r.tier === 'course' ? 'global' : 'private',
      answer: lifted.answer,
      citations: [
        ...citations,
        ...lifted.citations.filter(
          (c) => !c.chunk_id || !cited.has(c.chunk_id),
        ),
      ],
    })
  }
  const role = row.role === 'user' ? 'user' : 'assistant'
  const text = string(content.text)
  return {
    id: row.id,
    role,
    // An answer persisted before the server stripped Cognee's Evidence block still ends in
    // one; its Page badges are already lifted per tier above.
    content: (role === 'assistant' ? liftEvidence(text).answer : text) ?? '',
    query_type: string(content.query_type),
    results,
    used_notes: row.used_notes,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
  }
}

export async function listCourses(): Promise<Array<CourseSummary>> {
  const rows = await request<Array<CourseOut>>('/courses.list')
  return Promise.all(
    rows.map(async (row) => {
      const [materials, notes] = await Promise.all([
        listMaterials(row.code),
        listNotes(row.code),
      ])
      return {
        code: row.code,
        material_count: materials.length,
        note_count: notes.length,
        pending_count: [...materials, ...notes].filter(
          (r) => r.status === 'queued' || r.status === 'cognifying',
        ).length,
      }
    }),
  )
}
export async function joinCourse(course: string): Promise<void> {
  try {
    await request('/enrolments.join', json({ course }))
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error
    try {
      await request(
        '/courses.create',
        json({ code: course, name: course.toUpperCase() }),
      )
    } catch (creationError) {
      if (!(creationError instanceof ApiError) || creationError.status !== 409)
        throw creationError
    }
    await request('/enrolments.join', json({ course }))
  }
}
export async function listSessions(
  course: string,
): Promise<Array<SessionSummary>> {
  const rows = await request<Array<SessionOut>>(
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
  course: string,
  filename: string,
): Promise<Blob> {
  const rows = await request<Array<MaterialOut>>(
    query('/materials.list', { course }),
  )
  const row = rows
    .filter((r) => r.filename === filename)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .at(0)
  if (!row) throw new ApiError(404, 'no such material')
  return (
    await fetchResponse(query('/materials.download', { material: row.id }))
  ).blob()
}
export async function listMaterials(course: string): Promise<Array<Material>> {
  const rows = await request<Array<MaterialOut>>(
    query('/materials.list', { course }),
  )
  return rows.map((row) => materialView(course, row))
}
export async function uploadMaterial(
  course: string,
  file: File,
): Promise<Material> {
  const form = new FormData()
  form.append('course', course)
  form.append('file', file)
  const saved = await request<UploadOut>('/materials.upload', {
    method: 'POST',
    body: form,
  })
  return materialView(course, saved.material)
}
export async function listNotes(course: string): Promise<Array<Note>> {
  const [rows, owner] = await Promise.all([
    request<Array<NoteOut>>(query('/notes.list', { course })),
    meEmail(),
  ])
  return rows.map((row) => noteView(owner, course, row))
}
export async function saveNote(
  course: string,
  id: string,
  body_md: string,
): Promise<Note> {
  const note =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
      ? id
      : undefined
  return noteView(
    await meEmail(),
    course,
    await request<NoteOut>('/notes.save', json({ course, note, body_md })),
  )
}
export async function uploadNote(course: string, file: File): Promise<Note> {
  const form = new FormData()
  form.append('course', course)
  form.append('file', file)
  const saved = await request<NoteUploadOut>('/notes.upload', {
    method: 'POST',
    body: form,
  })
  return noteView(await meEmail(), course, saved.note)
}
/** A PDF Note's bytes. Unlike a Material, a Note is fetched by id: only its author has it. */
export async function downloadNote(note: string): Promise<Blob> {
  return (await fetchResponse(query('/notes.download', { note }))).blob()
}

export interface UploadResult {
  file: File
  error: string | null
}
/** The most files one selection may hold: each becomes its own request and Cognify run. */
export const MAX_UPLOAD_FILES = 10
/**
 * Every file at once; a failure is reported per file rather than aborting the batch.
 * A selection over MAX_UPLOAD_FILES is refused whole, before any request is sent.
 */
export function uploadEach(
  files: ArrayLike<File>,
  upload: (file: File) => Promise<unknown>,
): Promise<Array<UploadResult>> {
  if (files.length > MAX_UPLOAD_FILES)
    return Promise.reject(
      new Error(`Select at most ${MAX_UPLOAD_FILES} files at a time.`),
    )
  return Promise.all(
    Array.from(files, async (file) => {
      try {
        await upload(file)
        return { file, error: null }
      } catch (e) {
        return { file, error: e instanceof Error ? e.message : String(e) }
      }
    }),
  )
}
export async function ask(
  course: string,
  req: AskRequest,
): Promise<AskResponse> {
  const body: RpcAskRequest = {
    course,
    question: req.question,
    query_type: req.query_type,
    session: req.session_id,
  }
  const answer = await request<RpcAskOut>('/ask', json(body))
  return { session_id: answer.session, turn: turnView(answer.turn) }
}
export async function getSession(course: string, id: string): Promise<Session> {
  const [row, scope, owner] = await Promise.all([
    request<SessionOut>(query('/sessions.get', { session: id })),
    request<CourseOut>(query('/courses.get', { course })),
    meEmail(),
  ])
  if (row.course_id !== scope.id) throw new ApiError(404, 'no such session')
  return {
    id: row.id,
    course,
    owner,
    created_at: row.created_at,
    turns: row.turns.map(turnView),
  }
}

export async function getMe(): Promise<MeOut> {
  return request<MeOut>('/me.get')
}

export async function createInvite(
  role: 'student' | 'instructor' | 'admin' = 'student',
): Promise<InviteOut> {
  return request<InviteOut>('/invites.create', json({ role }))
}

/** react-query refetchInterval helper: poll while anything is still ingesting. */
export function pollWhilePending<T extends { status: IngestStatus }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => i.status === 'queued' || i.status === 'cognifying')
    ? 2000
    : false
}
