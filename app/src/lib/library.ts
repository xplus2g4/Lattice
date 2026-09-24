// Client-side library state: course codes the user has added (the server only
// knows a course once it holds something) and the last material opened, which
// drives the home screen's continue card. Keyed per signed-in user so a
// shared browser doesn't leak one account's "continue reading" into another's.

import { useCallback, useSyncExternalStore } from 'react'

import { useUser } from './user'

const KEY_PREFIX = 'lattice.library'

interface Library {
  courses: Array<string>
  lastOpened: { course: string; filename: string } | null
}

const EMPTY: Library = { courses: [], lastOpened: null }

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

function parse(raw: string | null): Library {
  if (!raw) return EMPTY
  try {
    const value = JSON.parse(raw) as Partial<Library>
    return {
      courses: value.courses ?? [],
      lastOpened: value.lastOpened ?? null,
    }
  } catch {
    return EMPTY
  }
}

// useSyncExternalStore requires a stable snapshot per (key, raw) pair.
let cache: { key: string; raw: string | null; value: Library } = {
  key: '',
  raw: null,
  value: EMPTY,
}

function getSnapshot(key: string): Library {
  if (!key) return EMPTY
  const raw = localStorage.getItem(key)
  if (key !== cache.key || raw !== cache.raw) {
    cache = { key, raw, value: parse(raw) }
  }
  return cache.value
}

function write(key: string, next: Library) {
  if (!key) return
  localStorage.setItem(key, JSON.stringify(next))
  listeners.forEach((l) => l())
}

/** Empty until the session query resolves; nothing is read or written for
 * an unknown user, so no history is ever attributed to the wrong account. */
export function useLibrary() {
  const user = useUser()
  const key = user ? `${KEY_PREFIX}:${user}` : ''
  const library = useSyncExternalStore(
    subscribe,
    () => getSnapshot(key),
    () => EMPTY,
  )

  const addCourse = useCallback(
    (code: string) => {
      if (!library.courses.includes(code)) {
        write(key, { ...library, courses: [...library.courses, code] })
      }
    },
    [key, library],
  )

  const markOpened = useCallback(
    (course: string, filename: string) => {
      write(key, { ...library, lastOpened: { course, filename } })
    },
    [key, library],
  )

  return {
    courses: library.courses,
    lastOpened: library.lastOpened,
    addCourse,
    markOpened,
  }
}
