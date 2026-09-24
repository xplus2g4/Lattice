import type { Citation, Material, Note } from '#/lib/api'

export interface PageSpan {
  start: number
  end: number
}

/** One cited Material or Note, with every cited Page span merged. */
export interface Source {
  name: string
  label: string
  /** The Material the reader can open, or null when it cannot show this source. */
  filename: string | null
  spans: Array<PageSpan>
}

export interface References {
  sources: Array<Source>
  concepts: Array<string>
}

function stem(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

/** Cognee names a document after its stored file, which is the Material's sha256. */
export function materialFor(
  name: string,
  materials: ReadonlyArray<Material>,
): Material | undefined {
  return (
    materials.find((m) => m.sha256 === name || m.sha256 === stem(name)) ??
    materials.find((m) => m.filename === name || stem(m.filename) === name)
  )
}

function noteLabel(note: Note): string {
  const line = note.body_md
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return line ?? note.id
}

function mergeSpans(spans: Array<PageSpan>): Array<PageSpan> {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Array<PageSpan> = []
  for (const s of sorted) {
    const prev = out.at(-1)
    if (prev && s.start <= prev.end + 1) prev.end = Math.max(prev.end, s.end)
    else out.push({ ...s })
  }
  return out
}

export function groupReferences(
  citations: ReadonlyArray<Citation>,
  materials: ReadonlyArray<Material>,
  notes: ReadonlyArray<Note>,
): References {
  const byName = new Map<string, Array<PageSpan>>()
  const concepts = new Set<string>()
  for (const c of citations) {
    if (c.kind === 'chunk') {
      if (!c.filename) continue
      const spans = byName.get(c.filename) ?? []
      if (c.page_start != null) {
        spans.push({
          start: c.page_start,
          end: Math.max(c.page_end ?? c.page_start, c.page_start),
        })
      }
      byName.set(c.filename, spans)
    } else {
      const concept = c.kind === 'relation' ? c.relation : c.label
      if (concept) concepts.add(concept)
    }
  }
  const sources = [...byName].map(([name, spans]): Source => {
    const material = materialFor(name, materials)
    const note = material
      ? undefined
      : notes.find((n) => n.id === name || n.id === stem(name))
    return {
      name,
      label: material?.filename ?? (note ? noteLabel(note) : name),
      filename:
        material && material.filename.toLowerCase().endsWith('.pdf')
          ? material.filename
          : null,
      spans: mergeSpans(spans),
    }
  })
  return { sources, concepts: [...concepts] }
}
