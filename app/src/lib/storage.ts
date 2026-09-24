import { useCallback, useSyncExternalStore } from 'react'

// localStorage as an external store so SSR renders the fallback and the
// client re-renders with the stored value after hydration.
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

const USER_KEY = 'lattice.user'
const DEFAULT_USER = 'alice@example.com'

/** The dev-only identity, until OAuth replaces it. Backed by the same external store the
 * header edits, so a section reads the current email without it being passed down. */
export function useUser() {
  return useStored(USER_KEY, DEFAULT_USER)
}

export function useStored(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) ?? fallback,
    () => fallback,
  )
  const set = useCallback(
    (next: string | null) => {
      if (next === null) localStorage.removeItem(key)
      else localStorage.setItem(key, next)
      listeners.forEach((l) => l())
    },
    [key],
  )
  return [value, set] as const
}
