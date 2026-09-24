/** The one fetch wrapper every API call goes through.
 *
 * Cookies do the talking (`credentials: 'include'`); an expired access token is
 * renewed at `/auth/refresh` once, silently, then the call retried. SSR never
 * fetches — the session cookie only exists in the browser, so queries stay
 * pending on the server and run after hydration.
 */
import { ApiError } from './api-error'

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:8000'

const isBrowser = typeof window !== 'undefined'

let refreshing: Promise<boolean> | null = null

/** One in-flight refresh at a time; resolves true when the session was renewed. */
function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!isBrowser) return new Promise<Response>(() => {})
  const call = () =>
    fetch(`${API_URL}${path}`, { credentials: 'include', ...init })
  let response = await call()
  if (
    response.status === 401 &&
    !path.startsWith('/auth/') &&
    (await tryRefresh())
  ) {
    response = await call()
  }
  return response
}

async function refused(response: Response): Promise<ApiError> {
  let detail = response.statusText
  try {
    const body = await response.json()
    if (typeof body?.detail === 'string') detail = body.detail
    else if (body?.detail) detail = JSON.stringify(body.detail)
  } catch {
    // Not JSON — keep the status text.
  }
  return new ApiError(response.status, detail)
}

function query(params?: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) search.set(key, value)
  }
  return search.size ? `?${search}` : ''
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const response = await apiFetch(`${path}${query(params)}`)
  if (!response.ok) throw await refused(response)
  return response.json()
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!response.ok) throw await refused(response)
  return response.json()
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const response = await apiFetch(path, { method: 'POST', body: form })
  if (!response.ok) throw await refused(response)
  return response.json()
}

export async function apiDownload(
  path: string,
  params: Record<string, string>,
): Promise<Blob> {
  const response = await apiFetch(`${path}${query(params)}`)
  if (!response.ok) throw await refused(response)
  return response.blob()
}
