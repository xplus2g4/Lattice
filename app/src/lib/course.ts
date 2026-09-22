export const COURSE_RE = /^[a-z][a-z0-9]{1,15}$/

export const RECENT_COURSES_KEY = 'lattice.courses'

const RECENT_MAX = 8

export function parseRecentCourses(json: string): Array<string> {
  try {
    const list: unknown = JSON.parse(json)
    return Array.isArray(list)
      ? list.filter((c): c is string => typeof c === 'string')
      : []
  } catch {
    return []
  }
}

export function recordRecentCourse(course: string) {
  const next = [
    course,
    ...parseRecentCourses(
      localStorage.getItem(RECENT_COURSES_KEY) ?? '[]',
    ).filter((c) => c !== course),
  ].slice(0, RECENT_MAX)
  localStorage.setItem(RECENT_COURSES_KEY, JSON.stringify(next))
}
