import type {
  AskRequest,
  AskResponse,
  Evidence,
  Material,
  Note,
  Session,
  TierResult,
  Turn,
  ValidationError,
} from '#/lib/generated'

// The API shape is generated from contracts/openapi.json (ADR 0005); never redeclare it
// here. This module owns the transport only: the base URL, the `X-User` identity header
// that OAuth will replace, and how a FastAPI error body becomes an Error.
export type {
  AskRequest,
  AskResponse,
  Evidence,
  Material,
  Note,
  Session,
  TierResult,
  Turn,
}

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// FastAPI inlines these unions into each field rather than naming them, so name them here.
export type IngestStatus = Material['status']
export type QueryType = NonNullable<AskRequest['query_type']>

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
