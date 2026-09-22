import { describe, expect, it } from 'vitest'
import {
  getReadingPosition,
  saveReadingPosition,
  getPageNote,
  savePageNote,
} from './api'
import { installReaderHandlers, READER_MATERIAL } from '#/test/reader-handlers'

describe('reader API', () => {
  it('restores reading positions independently for each student and Material', async () => {
    installReaderHandlers()
    await saveReadingPosition('alice@example.com', READER_MATERIAL, 7)
    expect(await getReadingPosition('alice@example.com', READER_MATERIAL)).toBe(
      7,
    )
    expect(await getReadingPosition('bob@example.com', READER_MATERIAL)).toBe(1)
    expect(
      await getReadingPosition('alice@example.com', 'another-material'),
    ).toBe(1)
  })
  it('passes Page identity and rejects a stale revision', async () => {
    installReaderHandlers()
    await savePageNote(
      'alice@example.com',
      'cs101',
      READER_MATERIAL,
      3,
      'First',
      0,
    )
    await expect(
      savePageNote(
        'alice@example.com',
        'cs101',
        READER_MATERIAL,
        3,
        'Stale',
        0,
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(
      (await getPageNote('alice@example.com', READER_MATERIAL, 3))?.body_md,
    ).toBe('First')
    expect(
      await getPageNote('alice@example.com', READER_MATERIAL, 2),
    ).toBeNull()
    expect(await getPageNote('bob@example.com', READER_MATERIAL, 3)).toBeNull()
  })
})
