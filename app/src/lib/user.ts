import { MOCK_API, useMe } from './auth'
import { useStored } from './storage'

export { useStored }

/** The signed-in user's email — what per-user cache keys are partitioned by.
 * Identity comes from the session (see `#/lib/auth`), never from input. */
export function useUser(): string {
  return useMe().data?.user.email ?? (MOCK_API ? 'mock@lattice.local' : '')
}
