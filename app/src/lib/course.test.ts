import { describe, expect, it } from 'vitest'

import {
  RECENT_COURSES_KEY,
  parseRecentCourses,
  recordRecentCourse,
} from '#/lib/course'

function recents() {
  return parseRecentCourses(localStorage.getItem(RECENT_COURSES_KEY) ?? '[]')
}

describe('recent courses', () => {
  it('lists the most recently opened course first', () => {
    recordRecentCourse('cs101')
    recordRecentCourse('ma102')

    expect(recents()).toEqual(['ma102', 'cs101'])
  })

  it('moves a re-opened course to the front rather than repeating it', () => {
    recordRecentCourse('cs101')
    recordRecentCourse('ma102')
    recordRecentCourse('cs101')

    expect(recents()).toEqual(['cs101', 'ma102'])
  })

  it('remembers only the eight most recent courses', () => {
    for (const code of [
      'cs1',
      'cs2',
      'cs3',
      'cs4',
      'cs5',
      'cs6',
      'cs7',
      'cs8',
      'cs9',
    ]) {
      recordRecentCourse(code)
    }

    expect(recents()).toEqual([
      'cs9',
      'cs8',
      'cs7',
      'cs6',
      'cs5',
      'cs4',
      'cs3',
      'cs2',
    ])
  })
})

describe('reading a stored course list', () => {
  it('reads back what was stored', () => {
    recordRecentCourse('cs101')

    expect(recents()).toEqual(['cs101'])
  })

  it('recovers from a value that is not JSON', () => {
    expect(parseRecentCourses('not json at all')).toEqual([])
  })

  it('recovers from a value that is JSON but not a list', () => {
    expect(parseRecentCourses('{"cs101": true}')).toEqual([])
  })

  it('skips entries that are not course codes', () => {
    expect(parseRecentCourses('["cs101", 7, null, "ma102"]')).toEqual([
      'cs101',
      'ma102',
    ])
  })
})
