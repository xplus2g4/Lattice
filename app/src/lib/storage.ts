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
