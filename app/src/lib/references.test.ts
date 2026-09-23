import { describe, expect, it } from 'vitest'

import { describePages } from '#/lib/api'
import { normalizeMath } from '#/lib/markdown'
import { groupReferences } from '#/lib/references'
import { evidence, material, note } from '#/test/fixtures'

describe('groupReferences', () => {
  it('merges the chunks of one Material into one source with merged page spans', () => {
    const refs = groupReferences(
      [
        evidence({ filename: 'week1', page_start: 7, page_end: 9 }),
        evidence({ filename: 'week1', page_start: 3, page_end: 4 }),
        evidence({ filename: 'week1', page_start: 4, page_end: 5 }),
      ],
      [material({ filename: 'week1.pdf' })],
      [],
    )

    expect(refs.sources).toEqual([
      {
        name: 'week1',
        label: 'week1.pdf',
        filename: 'week1.pdf',
        spans: [
          { start: 3, end: 5 },
          { start: 7, end: 9 },
        ],
      },
    ])
  })

  it('finds the Material a citation names by its sha256', () => {
    const sha = 'b'.repeat(64)
    const refs = groupReferences(
      [evidence({ filename: sha, page_start: 2, page_end: 2 })],
      [material({ filename: 'week2.pdf', sha256: sha })],
      [],
    )

    expect(refs.sources[0]).toMatchObject({
      label: 'week2.pdf',
      filename: 'week2.pdf',
      spans: [{ start: 2, end: 2 }],
    })
  })

  it('keeps a source without pages, and one the reader cannot open, unlinked', () => {
    const refs = groupReferences(
      [evidence({ filename: 'syllabus' }), evidence({ filename: 'n7' })],
      [material({ filename: 'syllabus.txt' })],
      [note({ id: 'n7', body_md: '# Hashing recap\nbuckets' })],
    )

    expect(refs.sources).toEqual([
      { name: 'syllabus', label: 'syllabus.txt', filename: null, spans: [] },
      { name: 'n7', label: 'Hashing recap', filename: null, spans: [] },
    ])
  })

  it('lists graph relations and nodes as concepts, not sources', () => {
    const refs = groupReferences(
      [
        evidence({ kind: 'relation', filename: null, relation: 'is_a' }),
        evidence({ kind: 'relation', filename: null, relation: 'is_a' }),
        evidence({ kind: 'node', filename: null, label: 'Hash table' }),
      ],
      [],
      [],
    )

    expect(refs).toEqual({ sources: [], concepts: ['is_a', 'Hash table'] })
  })
})

describe('describePages', () => {
  it('reads a single page and a range', () => {
    expect(describePages({ page_start: 3, page_end: 3 })).toBe('p. 3')
    expect(describePages({ page_start: 3, page_end: 5 })).toBe('p. 3–5')
    expect(describePages({ page_start: null, page_end: null })).toBe('')
  })
})

describe('normalizeMath', () => {
  it('rewrites bracket delimiters as dollar math', () => {
    expect(normalizeMath('so \\(x^2\\) and \\[\\sum_i i\\]')).toBe(
      'so $x^2$ and \n$$\n\\sum_i i\n$$\n',
    )
  })

  it('leaves code untouched', () => {
    const md = 'see `\\(x\\)` and\n```\n\\[y\\]\n```'
    expect(normalizeMath(md)).toBe(md)
  })
})
