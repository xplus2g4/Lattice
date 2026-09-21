// localStorage as an external store so SSR renders the fallback and the
// client re-renders with the stored value after hydration.

import { useStored } from './storage'

export { useStored } from './storage'

/** The email sent as X-User on every API call. Dev-header auth, same as /dev. */
export function useUser() {
  return useStored('lattice.user', 'alice@example.com')
}
