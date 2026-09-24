/** Who is signed in.
 *
 * `meQuery` is the session probe every gate and identity read shares: it runs
 * `/me.get`, which silently passes through `/auth/refresh` inside `apiFetch`
 * when the access cookie has expired but the refresh cookie is still good.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'

import { apiGet, apiPost } from './http'

/** `VITE_MOCK_API=1` runs the shell with no server: no session, no gating. */
export const MOCK_API = import.meta.env.VITE_MOCK_API === '1'

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: string
  notes_opt_out: boolean
}

interface MeWire {
  user: SessionUser
  courses: Array<{ code: string; name: string }>
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => apiGet<MeWire>('/me.get'),
  staleTime: 60_000,
  retry: false,
})

export function useMe() {
  return useQuery({ ...meQuery, enabled: !MOCK_API })
}

/** Google sign-in (and first-time sign-up — `invitationCode` is checked then). */
export function signInWithGoogle(credential: string, invitationCode: string) {
  return apiPost('/auth/google', {
    credential,
    invitation_code: invitationCode || null,
  })
}

/** The dev-only login: a real session cookie without Google. */
export function signInDev(email: string, invitationCode: string) {
  return apiPost('/auth/dev', {
    email,
    invitation_code: invitationCode || null,
  })
}

export function signOut() {
  return apiPost('/auth/logout')
}
