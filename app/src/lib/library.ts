// Client-side library state: course codes the user has added (the server only
// knows a course once it holds something) and the last material opened, which
// drives the home screen's continue card.

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
let cache: { raw: string | null; value: Library } = { raw: null, value: EMPTY }

function getSnapshot(): Library {
  const raw = localStorage.getItem(KEY)
  if (raw !== cache.raw) cache = { raw, value: parse(raw) }
  return cache.value
}

function write(next: Library) {
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}

export function useLibrary() {
  const library = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)

  const addCourse = useCallback(
    (code: string) => {
      if (!library.courses.includes(code)) {
        write({ ...library, courses: [...library.courses, code] })
      }
    },
    [library],
  )

  const markOpened = useCallback(
    (course: string, filename: string) => {
      write({ ...library, lastOpened: { course, filename } })
    },
    [library],
  )

  return { courses: library.courses, lastOpened: library.lastOpened, addCourse, markOpened }
}
