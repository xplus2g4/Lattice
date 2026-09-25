// Client-side library state: course codes the user has added (the server only
// knows a course once it holds something) and the last material opened, which
// drives the home screen's continue card. Keyed per signed-in user so a
// shared browser doesn't leak one account's "continue reading" into another's.

import { useCallback, useSyncExternalStore } from 'react'

import { useUser } from './user'

const KEY_PREFIX = 'lattice.library'

interface Library {
  courses: Array<string>
  /** `at` is an ISO timestamp; absent on records written before it was tracked. */
  lastOpened: { course: string; filename: string; at?: string } | null
  /** Course code -> ISO timestamp of the last time its workspace was opened. */
  openedAt: Record<string, string>
}

const EMPTY: Library = { courses: [], lastOpened: null, openedAt: {} }

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
      openedAt:
        value.openedAt && typeof value.openedAt === 'object'
          ? value.openedAt
          : {},
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

  // The mutators read the latest value from storage at call time rather than closing over
  // the snapshot, so their identity is stable across writes: an effect that calls one (a
  // fresh timestamp each time) then would not re-fire itself into a loop.
  const addCourse = useCallback(
    (code: string) => {
      const current = getSnapshot(key)
      if (!current.courses.includes(code)) {
        write(key, { ...current, courses: [...current.courses, code] })
      }
    },
    [key],
  )

  const markOpened = useCallback(
    (course: string, filename: string) => {
      const current = getSnapshot(key)
      const at = new Date().toISOString()
      write(key, {
        ...current,
        lastOpened: { course, filename, at },
        openedAt: { ...current.openedAt, [course]: at },
      })
    },
    [key],
  )

  const markCourseOpened = useCallback(
    (course: string) => {
      const current = getSnapshot(key)
      write(key, {
        ...current,
        openedAt: { ...current.openedAt, [course]: new Date().toISOString() },
      })
    },
    [key],
  )

  return {
    courses: library.courses,
    lastOpened: library.lastOpened,
    openedAt: library.openedAt,
    addCourse,
    markOpened,
    markCourseOpened,
  }
}
