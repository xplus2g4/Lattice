/** In-memory stand-in for the API, so the app runs with no server behind it.
 *
 * Every export here mirrors one API call and returns the shape `#/lib/api`
 * declares. State lives for the life of the tab: uploads, Notes and Sessions
 * survive navigation and are gone on reload.
 */
import { ApiError } from './api-error'

import type {
  AskRequest,
  AskResponse,
  CourseSummary,
  IngestStatus,
  Material,
  Note,
  PageNote,
  Session,
  SessionSummary,
  TierResult,
  Turn,
} from './api'

interface StoredMaterial {
  material: Material
  bytes: Blob
}

interface StoredCourse {
  materials: Map<string, StoredMaterial>
  notes: Map<string, Note>
  sessions: Map<string, Session>
}

const COGNIFY_MS = 2500

const store = new Map<string, StoredCourse>()
const materialIds = new WeakMap<StoredMaterial, string>()
const pageNotes = new Map<string, PageNote>()
const readingPositions = new Map<string, number>()

export async function getReaderMaterial(
  user: string,
  code: string,
  filename: string,
) {
  seed(user)
  const entry = course(code).materials.get(filename)
  if (!entry) throw new ApiError(404, 'no such material')
  let id = materialIds.get(entry)
  if (!id) {
    id = crypto.randomUUID()
    materialIds.set(entry, id)
  }
  return { id, filename }
}

function pageKey(user: string, material: string, page: number) {
  return JSON.stringify([user, material, page])
}

export async function getPageNote(
  user: string,
  material: string,
  page: number,
) {
  await sleep()
  return pageNotes.get(pageKey(user, material, page)) ?? null
}

export async function savePageNote(
  user: string,
  code: string,
  material: string,
  page: number,
  body_md: string,
  expected_revision: number,
): Promise<PageNote> {
  await sleep(300)
  const key = pageKey(user, material, page)
  const previous = pageNotes.get(key)
  if (previous?.body_md === body_md) return previous
  if ((previous?.revision ?? 0) !== expected_revision)
    throw new ApiError(
      409,
      'Note changed; read its current revision before editing',
    )
  const note: PageNote = {
    id: previous?.id ?? crypto.randomUUID(),
    body_md,
    revision: expected_revision + 1,
    cognified_revision: expected_revision,
    status: 'dirty',
    error: null,
  }
  pageNotes.set(key, note)
  course(code).notes.set(note.id, {
    ...note,
    course: code,
    owner: user,
    status: 'queued',
    updated_at: now(),
  })
  setTimeout(() => {
    if (pageNotes.get(key) !== note) return
    pageNotes.set(key, {
      ...note,
      status: 'ready',
      cognified_revision: note.revision,
    })
    const listed = course(code).notes.get(note.id)
    if (listed) course(code).notes.set(note.id, { ...listed, status: 'ready' })
  }, COGNIFY_MS)
  return note
}

export async function getReadingPosition(user: string, material: string) {
  await sleep()
  return readingPositions.get(JSON.stringify([user, material])) ?? 1
}

export async function saveReadingPosition(
  user: string,
  material: string,
  page: number,
) {
  readingPositions.set(JSON.stringify([user, material]), page)
}

function now(): string {
  return new Date().toISOString()
}

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function sleep(ms = 140): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function course(code: string): StoredCourse {
  const existing = store.get(code)
  if (existing) return existing
  const created: StoredCourse = {
    materials: new Map(),
    notes: new Map(),
    sessions: new Map(),
  }
  store.set(code, created)
  return created
}

function text(body: string): Blob {
  return new Blob([body], { type: 'text/plain' })
}

/** A one-page PDF, written out by hand so the reader has something real to render. */
function pdf(title: string): Blob {
  const page = `BT /F1 24 Tf 72 700 Td (${title}) Tj 0 -36 Td /F1 12 Tf (Sample Material served by the mock API.) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: Array<number> = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const startxref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return new Blob([body], { type: 'application/pdf' })
}

function makeMaterial(
  code: string,
  filename: string,
  status: IngestStatus,
  minutesAgo: number,
): Material {
  return {
    course: code,
    filename,
    status,
    error: status === 'failed' ? 'RuntimeError: conversion timed out' : null,
    created_at: ago(minutesAgo),
    updated_at: ago(minutesAgo),
  }
}

function seedMaterial(
  code: string,
  filename: string,
  bytes: Blob,
  status: IngestStatus = 'ready',
  minutesAgo = 60,
): void {
  course(code).materials.set(filename, {
    material: makeMaterial(code, filename, status, minutesAgo),
    bytes,
  })
}

function seedNote(
  code: string,
  user: string,
  id: string,
  body_md: string,
  minutesAgo: number,
): void {
  course(code).notes.set(id, {
    course: code,
    owner: user,
    id,
    body_md,
    status: 'ready',
    error: null,
    updated_at: ago(minutesAgo),
  })
}

function tier(
  name: 'global' | 'private',
  answer: string,
  filename: string,
): TierResult {
  return {
    tier: name,
    answer,
    citations: [
      { kind: 'chunk', filename, chunk_index: 3, relation: null, label: null },
      {
        kind: 'relation',
        filename: null,
        chunk_index: null,
        relation: 'covers',
        label: null,
      },
    ],
  }
}

function seedSession(code: string, user: string): void {
  const id = 'seed-session'
  course(code).sessions.set(id, {
    id,
    course: code,
    owner: user,
    created_at: ago(120),
    turns: [
      {
        id: 'seed-turn-1',
        role: 'user',
        content: 'What is covered in week one?',
        query_type: 'GRAPH_COMPLETION',
        results: [],
        used_notes: false,
        latency_ms: null,
        created_at: ago(120),
      },
      {
        id: 'seed-turn-2',
        role: 'assistant',
        content:
          'Week one introduces the course structure and the first project milestone.',
        query_type: 'GRAPH_COMPLETION',
        results: [
          tier(
            'global',
            'Week one introduces the course structure and the first project milestone.',
            'week-1-intro.pdf',
          ),
        ],
        used_notes: false,
        latency_ms: 1840,
        created_at: ago(119),
      },
    ],
  })
}

let seeded = false

function seed(user: string): void {
  if (seeded) return
  seeded = true
  seedMaterial(
    'cs3216',
    'week-1-intro.pdf',
    pdf('CS3216 - Week 1'),
    'ready',
    90,
  )
  seedMaterial(
    'cs3216',
    'syllabus.md',
    text(
      '# Syllabus\n\n1. Product engineering\n2. Teamwork\n3. Final project\n',
    ),
    'ready',
    88,
  )
  seedMaterial(
    'cs3216',
    'week-2-teams.pdf',
    pdf('CS3216 - Week 2'),
    'cognifying',
    2,
  )
  seedMaterial(
    'cs2040s',
    'analysis.md',
    text('# Analysis\n\nBig-O recap.\n'),
    'ready',
    240,
  )
  seedNote('cs3216', user, 'week-1', 'Milestone one is due in week three.', 45)
  seedSession('cs3216', user)
}

function summary(code: string, entry: StoredCourse): CourseSummary {
  const materials = [...entry.materials.values()].map((m) => m.material)
  return {
    code,
    material_count: materials.length,
    note_count: entry.notes.size,
    pending_count: materials.filter(
      (m) => m.status === 'queued' || m.status === 'cognifying',
    ).length,
  }
}

/** Walks an upload through the Cognify statuses the real pipeline reports. */
function cognify(entry: StoredMaterial): void {
  const advance = (status: IngestStatus) => {
    entry.material = { ...entry.material, status, updated_at: now() }
  }
  setTimeout(() => advance('cognifying'), COGNIFY_MS / 2)
  setTimeout(() => advance('ready'), COGNIFY_MS)
}

export async function listCourses(user: string): Promise<Array<CourseSummary>> {
  seed(user)
  await sleep()
  return [...store.entries()]
    .map(([code, entry]) => summary(code, entry))
    .sort((a, b) => a.code.localeCompare(b.code))
}

export async function listMaterials(
  user: string,
  code: string,
): Promise<Array<Material>> {
  seed(user)
  await sleep()
  return [...course(code).materials.values()]
    .map((m) => m.material)
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

export async function uploadMaterial(
  user: string,
  code: string,
  file: File,
): Promise<Material> {
  seed(user)
  await sleep(400)
  const entry: StoredMaterial = {
    material: makeMaterial(code, file.name, 'queued', 0),
    bytes: file,
  }
  course(code).materials.set(file.name, entry)
  cognify(entry)
  return entry.material
}

export async function downloadMaterial(
  user: string,
  code: string,
  filename: string,
): Promise<Blob> {
  seed(user)
  await sleep()
  const entry = course(code).materials.get(filename)
  if (!entry) throw new ApiError(404, 'no such material')
  return entry.bytes
}

export async function listNotes(
  user: string,
  code: string,
): Promise<Array<Note>> {
  seed(user)
  await sleep()
  return [...course(code).notes.values()]
    .filter((n) => n.owner === user)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
}

export async function saveNote(
  user: string,
  code: string,
  id: string,
  body_md: string,
): Promise<Note> {
  seed(user)
  await sleep(300)
  const note: Note = {
    course: code,
    owner: user,
    id,
    body_md,
    status: 'ready',
    error: null,
    updated_at: now(),
  }
  course(code).notes.set(id, note)
  for (const [key, anchored] of pageNotes) {
    if (anchored.id === id) {
      const revision =
        anchored.revision + (anchored.body_md === body_md ? 0 : 1)
      pageNotes.set(key, {
        ...anchored,
        body_md,
        revision,
        cognified_revision: revision,
        status: 'ready',
      })
    }
  }
  return note
}

export async function listSessions(
  user: string,
  code: string,
): Promise<Array<SessionSummary>> {
  seed(user)
  await sleep()
  return [...course(code).sessions.values()]
    .map((s) => ({
      id: s.id,
      created_at: s.created_at,
      turn_count: s.turns.length,
      first_question: s.turns.find((t) => t.role === 'user')?.content ?? null,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function getSession(
  user: string,
  code: string,
  id: string,
): Promise<Session> {
  seed(user)
  await sleep()
  const session = course(code).sessions.get(id)
  if (!session) throw new ApiError(404, 'no such session')
  return session
}

function answerTo(question: string, filename: string): Array<TierResult> {
  return [
    tier(
      'global',
      `The Materials say: ${question.replace(/\?+$/, '')} is covered in ${filename}.`,
      filename,
    ),
    tier('private', 'Your Notes add nothing on this yet.', filename),
  ]
}

export async function ask(
  user: string,
  code: string,
  req: AskRequest,
): Promise<AskResponse> {
  seed(user)
  await sleep(900)
  const entry = course(code)
  const id = req.session_id || `session-${entry.sessions.size + 1}`
  const session: Session = entry.sessions.get(id) ?? {
    id,
    course: code,
    owner: user,
    created_at: now(),
    turns: [],
  }
  const filename =
    [...entry.materials.keys()].find((f) => f.endsWith('.pdf')) ??
    'week-1-intro.pdf'
  const question: Turn = {
    id: `${id}-u${session.turns.length}`,
    role: 'user',
    content: req.question,
    query_type: req.query_type,
    results: [],
    used_notes: false,
    latency_ms: null,
    created_at: now(),
  }
  const answer: Turn = {
    id: `${id}-a${session.turns.length + 1}`,
    role: 'assistant',
    content: `The Materials say: ${req.question.replace(/\?+$/, '')} is covered in ${filename}.`,
    query_type: req.query_type,
    results: answerTo(req.question, filename),
    used_notes: entry.notes.size > 0,
    latency_ms: 900,
    created_at: now(),
  }
  session.turns = [...session.turns, question, answer]
  entry.sessions.set(id, session)
  return { session_id: id, turn: answer }
}
