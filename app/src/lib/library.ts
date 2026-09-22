// Browser bookmarks, including legacy courses that predate API registration.

import { useCallback, useSyncExternalStore } from 'react'
import { parseRecentCourses, RECENT_COURSES_KEY } from './course'

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

  const addCourse = useCallback((code: string) => {
    const current = getSnapshot()
    if (!current.courses.includes(code)) {
      write({ ...current, courses: [...current.courses, code] })
    }
  }, [])

  const removeCourse = useCallback((code: string, user: string) => {
    const current = getSnapshot()
    write({
      courses: current.courses.filter((c) => c !== code),
      lastOpened:
        current.lastOpened?.course === code ? null : current.lastOpened,
    })
    localStorage.setItem(
      RECENT_COURSES_KEY,
      JSON.stringify(
        parseRecentCourses(
          localStorage.getItem(RECENT_COURSES_KEY) ?? '[]',
        ).filter((c) => c !== code),
      ),
    )
    for (const mode of ['api', 'demo'])
      localStorage.removeItem(`lattice.session.${mode}.${code}.${user}`)
  }, [])

  const markOpened = useCallback((course: string, filename: string) => {
    const current = getSnapshot()
    if (
      current.lastOpened?.course !== course ||
      current.lastOpened.filename !== filename
    ) {
      write({ ...current, lastOpened: { course, filename } })
    }
  }, [])

  return {
    courses: library.courses,
    lastOpened: library.lastOpened,
    addCourse,
    removeCourse,
    markOpened,
  }
}
