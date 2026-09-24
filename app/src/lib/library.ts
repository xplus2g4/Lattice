// Client-side library state: course codes the user has added (the server only
// knows a course once it holds something) and the last material opened, which
// drives the home screen's continue card. Keyed per user — one browser may
// hold several accounts, and their libraries must not bleed into each other.

import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'lattice.library'

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

// useSyncExternalStore requires a stable snapshot per raw value.
let cache: { key: string; raw: string | null; value: Library } = {
  key: '',
  raw: null,
  value: EMPTY,
}

function getSnapshot(key: string): Library {
  const raw = localStorage.getItem(key)
  if (key !== cache.key || raw !== cache.raw) {
    cache = { key, raw, value: parse(raw) }
  }
  return cache.value
}

function write(key: string, next: Library) {
  localStorage.setItem(key, JSON.stringify(next))
  listeners.forEach((l) => l())
}

export function useLibrary(user: string) {
  const key = `${KEY}.${user || 'anonymous'}`
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
