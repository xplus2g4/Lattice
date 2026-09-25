import { describe, expect, it } from 'vitest'

import { cleanTitle, fileExtLabel, greeting, relativeTime } from './format'

describe('cleanTitle', () => {
  it('drops the extension and a copy suffix, spaces and capitalizes', () => {
    expect(cleanTitle('kant_whatisenlightenment (1).pdf')).toBe(
      'Kant Whatisenlightenment',
    )
  })

  it('turns underscores and dashes into spaced words', () => {
    expect(cleanTitle('week1_lecture-notes.pdf')).toBe('Week1 Lecture Notes')
  })

  it('falls back to the name when cleaning empties it', () => {
    expect(cleanTitle('(1).pdf')).toBe('(1)')
  })
})

describe('fileExtLabel', () => {
  it('uppercases the extension', () => {
    expect(fileExtLabel('slides.pdf')).toBe('PDF')
    expect(fileExtLabel('notes.MD')).toBe('MD')
  })

  it('labels an extensionless name as FILE', () => {
    expect(fileExtLabel('README')).toBe('FILE')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-01-02T12:00:00.000Z')

  it('reads recent times', () => {
    expect(relativeTime('2026-01-02T11:59:30.000Z', now)).toBe('just now')
    expect(relativeTime('2026-01-02T11:30:00.000Z', now)).toBe('30 minutes ago')
    expect(relativeTime('2026-01-02T10:00:00.000Z', now)).toBe('2 hours ago')
    expect(relativeTime('2026-01-01T12:00:00.000Z', now)).toBe('1 day ago')
  })

  it('returns null for missing or unparseable input', () => {
    expect(relativeTime(null, now)).toBeNull()
    expect(relativeTime('nonsense', now)).toBeNull()
  })
})

describe('greeting', () => {
  // seed 0 always picks the first (canonical) phrasing of each band.
  it('follows the time of day', () => {
    expect(greeting(8, '', 0)).toBe('Good morning')
    expect(greeting(14, '', 0)).toBe('Good afternoon')
    expect(greeting(19, '', 0)).toBe('Good evening')
  })

  it('is playful in the small hours', () => {
    expect(greeting(2, '', 0)).toBe('Burning the midnight oil?')
    expect(greeting(23, '', 0)).toBe('Burning the midnight oil?')
  })

  it('weaves the name in, keeping a question mark last', () => {
    expect(greeting(8, 'Ada', 0)).toBe('Good morning, Ada')
    expect(greeting(2, 'Ada', 0)).toBe('Burning the midnight oil, Ada?')
  })

  it('varies the phrasing with the seed', () => {
    expect(greeting(8, '', 0.9)).toBe('Morning')
  })
})
