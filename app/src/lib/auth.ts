/** Client-facing auth: server functions that read the session and a cached Bearer
 * token for API calls. Server-only imports stay inside the handlers. */
import { createServerFn } from '@tanstack/react-start'

export interface SessionUser {
  sub: string
  email: string
  name?: string
  picture?: string
}

export const getSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const { session } = await import('./auth.server')
    const s = await session()
    const { sub, email, name, picture } = s.data
    return sub && email ? { sub, email, name, picture } : null
  },
)

export const getApiToken = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ token: string; expiresAt: number } | null> => {
    const { mintToken, session } = await import('./auth.server')
    const s = await session()
    const { sub, email, name } = s.data
    if (!sub || !email) return null
    return mintToken({ sub, email, name })
  },
)

export const redeemInvite = createServerFn({ method: 'POST' })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { apiCall, mintToken, session } = await import('./auth.server')
    const s = await session()
    const { sub, email, name } = s.data
    if (!sub || !email) return { ok: false }
    const { token } = await mintToken({ sub, email, name })
    const res = await apiCall('/invites.redeem', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.token }),
    })
    return { ok: res.ok }
  })

let cached: { token: string; expiresAt: number } | null = null

/** The Bearer token for API calls, minted by the web server while the session lives. */
export async function apiToken(): Promise<string | null> {
  if (cached && cached.expiresAt * 1000 > Date.now() + 30_000)
    return cached.token
  cached = await getApiToken()
  return cached?.token ?? null
}

export function clearApiTokenCache() {
  cached = null
}
