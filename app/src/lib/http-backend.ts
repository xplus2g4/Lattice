/** The real API behind `#/lib/api`.
 *
 * Mirrors `mock-backend`'s exports one-for-one so the backend can be swapped by
 * env var. The `user` argument is kept for signature parity — the session cookie
 * carries identity; it only fills the `owner` field the UI shapes declare.
 * Everything else adapts the server's wire shapes to the app's UI shapes.
 */
import { apiDownload, apiGet, apiPost, apiPostForm } from './http'
import { ApiError } from './api-error'

import type {
  AskRequest,
  AskResponse,
  Citation,
  CourseInfo,
  CourseSummary,
  IngestStatus,
  Material,
  Note,
  Session,
  SessionSummary,
  TierResult,
  Turn,
} from './api'

// --- Wire shapes: what the FastAPI endpoints actually return ---

interface CourseSummaryWire {
  code: string
  name: string
  material_count: number
  note_count: number
  pending_count: number
}

interface MaterialWire {
  id: string
  filename: string
  status: IngestStatus
  error: string | null
  created_at: string
  updated_at: string
}

interface NoteWire {
  id: string
  body_md: string
  // The server says dirty/indexing; the UI says queued/cognifying.
  status: string
  error: string | null
  updated_at: string
}

interface EvidenceWire {
  kind: string
  document_name?: string | null
  chunk_index?: number | null
  relationship_name?: string | null
  label?: string | null
}

interface TierResultWire {
  tier: 'course' | 'notes'
  answer: string | null
  evidence: Array<EvidenceWire>
}

interface TurnWire {
  id: string
  role: 'user' | 'assistant'
  content_json: {
    text?: string
    query_type?: string | null
    results?: Array<TierResultWire>
  }
  used_notes: boolean
  latency_ms: number | null
  created_at: string
}

interface SessionWire {
  id: string
  turns: Array<TurnWire>
  created_at: string
}

interface UploadWire {
  material: MaterialWire
  deduplicated: boolean
}

interface CourseSearchWire {
  results: Array<{
    course: { code: string; name: string }
    enrolled: boolean
  }>
}

interface AskWire {
  session: string
  turn: TurnWire
}

// --- Adapters: wire shape -> the UI shape api.ts declares ---

const NOTE_STATUS: Record<string, IngestStatus | undefined> = {
  dirty: 'queued',
  indexing: 'cognifying',
  ready: 'ready',
  failed: 'failed',
}

function toMaterial(wire: MaterialWire, course: string): Material {
  return { course, ...wire }
}

function toNote(wire: NoteWire, course: string, user: string): Note {
  return {
    course,
    owner: user,
    id: wire.id,
    body_md: wire.body_md,
    status: NOTE_STATUS[wire.status] ?? 'ready',
    error: wire.error,
    updated_at: wire.updated_at,
  }
}

function toCitation(wire: EvidenceWire): Citation {
  return {
    kind: wire.kind,
    filename: wire.document_name ?? null,
    chunk_index: wire.chunk_index ?? null,
    relation: wire.relationship_name ?? null,
    label: wire.label ?? null,
  }
}

function toTier(wire: TierResultWire): TierResult {
  return {
    tier: wire.tier === 'notes' ? 'private' : 'global',
    answer: wire.answer,
    citations: wire.evidence.map(toCitation),
  }
}

function toTurn(wire: TurnWire): Turn {
  return {
    id: wire.id,
    role: wire.role,
    content: wire.content_json.text ?? '',
    query_type: wire.content_json.query_type ?? null,
    results: (wire.content_json.results ?? []).map(toTier),
    used_notes: wire.used_notes,
    latency_ms: wire.latency_ms,
    created_at: wire.created_at,
  }
}

function toSession(wire: SessionWire, course: string, user: string): Session {
  return {
    id: wire.id,
    course,
    owner: user,
    turns: wire.turns.map(toTurn),
    created_at: wire.created_at,
  }
}

// --- The calls ---

export async function listCourses(
  _user: string,
): Promise<Array<CourseSummary>> {
  const summaries = await apiGet<Array<CourseSummaryWire>>('/courses.summary')
  return summaries.map((s) => ({
    code: s.code,
    material_count: s.material_count,
    note_count: s.note_count,
    pending_count: s.pending_count,
  }))
}

export async function getCourse(
  _user: string,
  code: string,
): Promise<CourseInfo> {
  // Search answers both halves of the probe: an exact-code hit means the course
  // exists and the row carries the caller's enrolment state.
  const wire = await apiGet<CourseSearchWire>('/courses.search', { q: code })
  const hit = wire.results.find((r) => r.course.code === code.toLowerCase())
  if (!hit) throw new ApiError(404, 'no such course')
  return {
    code: hit.course.code,
    name: hit.course.name,
    enrolled: hit.enrolled,
  }
}

export async function joinCourse(_user: string, code: string): Promise<void> {
  try {
    await apiPost('/enrolments.join', { course: code })
  } catch (error) {
    // The code belongs to nobody yet: create it, then enrol as its owner.
    if (!(error instanceof ApiError && error.status === 404)) throw error
    await apiPost('/courses.create', { code, name: code })
    await apiPost('/enrolments.join', { course: code })
  }
}

export async function listMaterials(
  _user: string,
  code: string,
): Promise<Array<Material>> {
  const wires = await apiGet<Array<MaterialWire>>('/materials.list', {
    course: code,
  })
  return wires.map((w) => toMaterial(w, code))
}

export async function uploadMaterial(
  _user: string,
  code: string,
  file: File,
): Promise<Material> {
  const form = new FormData()
  form.set('course', code)
  form.set('file', file)
  const uploaded = await apiPostForm<UploadWire>('/materials.upload', form)
  return toMaterial(uploaded.material, code)
}

export function downloadMaterial(
  _user: string,
  code: string,
  filename: string,
): Promise<Blob> {
  return apiDownload('/materials.download', { course: code, filename })
}

export async function listNotes(
  user: string,
  code: string,
): Promise<Array<Note>> {
  const wires = await apiGet<Array<NoteWire>>('/notes.list', { course: code })
  return wires.map((w) => toNote(w, code, user))
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function saveNote(
  user: string,
  code: string,
  id: string | null,
  body_md: string,
): Promise<Note> {
  const wire = await apiPost<NoteWire>('/notes.save', {
    course: code,
    body_md,
    // A server uuid edits that Note; anything else is a fresh jotting.
    note: id && UUID_RE.test(id) ? id : undefined,
  })
  return toNote(wire, code, user)
}

export async function listSessions(
  _user: string,
  code: string,
): Promise<Array<SessionSummary>> {
  const wires = await apiGet<Array<SessionWire>>('/sessions.list', {
    course: code,
  })
  return wires.map((s) => ({
    id: s.id,
    created_at: s.created_at,
    turn_count: s.turns.length,
    first_question:
      s.turns.find((t) => t.role === 'user')?.content_json.text ?? null,
  }))
}

export async function getSession(
  user: string,
  code: string,
  id: string,
): Promise<Session> {
  const wire = await apiGet<SessionWire>('/sessions.get', { session: id })
  return toSession(wire, code, user)
}

export async function ask(
  _user: string,
  code: string,
  req: AskRequest,
): Promise<AskResponse> {
  const wire = await apiPost<AskWire>('/ask', {
    course: code,
    question: req.question,
    query_type: req.query_type,
    session: req.session_id ?? undefined,
  })
  return { session_id: wire.session, turn: toTurn(wire.turn) }
}
