// Where the reader was in each PDF tab, so a tab that was unloaded (only a few stay
// loaded) comes back at the same Page. Written straight to localStorage without telling
// any subscriber: scrolling must never re-render the workspace.

import type { TabKey } from './tabs'

function storageKey(user: string, course: string) {
  return `lattice.reading:${user}:${course}`
}

function positions(user: string, course: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(user, course)) ?? '{}',
    )
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readingPosition(
  user: string,
  course: string,
  tab: TabKey,
): number | undefined {
  const page = positions(user, course)[tab]
  return typeof page === 'number' && Number.isInteger(page) && page > 0
    ? page
    : undefined
}

export function saveReadingPosition(
  user: string,
  course: string,
  tab: TabKey,
  page: number,
) {
  try {
    localStorage.setItem(
      storageKey(user, course),
      JSON.stringify({ ...positions(user, course), [tab]: page }),
    )
  } catch {
    // Storage full or blocked: the tab just reopens at its first Page.
  }
}
