import type {
  AskResponse,
  Citation,
  Grill,
  GrillQuestion,
  Material,
  Note,
  Session,
  TierResult,
  Turn,
} from '#/lib/api'

// These fixtures describe the UI view models; the HTTP handlers serialize them into
// generated RPC contract types (ADR 0005). A server model change therefore fails
// typecheck in the handlers rather than drifting into a parallel wire shape.

const AT = '2026-01-01T00:00:00.000Z'

export function material(over: Partial<Material> = {}): Material {
  const filename = over.filename ?? 'week1.pdf'
  return {
    // Distinct per filename, so two fixtures in one course never share a key.
    id: `m-${filename}`,
    course: 'cs101',
    filename: 'week1.pdf',
    title: 'week1.pdf',
    page_count: null,
    sha256: 'a'.repeat(64),
    status: 'ready',
    error: null,
    created_at: AT,
    updated_at: AT,
    ...over,
  }
}

export function note(over: Partial<Note> = {}): Note {
  return {
    course: 'cs101',
    owner: 'alice@example.com',
    id: 'n1',
    body_md: 'hash tables are week 3',
    filename: null,
    sha256: null,
    status: 'ready',
    error: null,
    updated_at: AT,
    ...over,
  }
}

export function evidence(over: Partial<Citation> = {}): Citation {
  return {
    kind: 'chunk',
    chunk_id: 'chunk-1',
    chunk_index: 3,
    filename: 'week1.pdf',
    label: null,
    relation: null,
    ...over,
  }
}

export function tierResult(over: Partial<TierResult> = {}): TierResult {
  return {
    tier: 'global',
    course: 'cs101',
    answer: 'A hash table maps keys to buckets.',
    citations: [evidence()],
    ...over,
  }
}

export function userTurn(content: string, over: Partial<Turn> = {}): Turn {
  return {
    id: `user-${content.length}`,
    role: 'user',
    content,
    query_type: null,
    results: [],
    used_notes: false,
    latency_ms: null,
    created_at: AT,
    ...over,
  }
}

export function assistantTurn(over: Partial<Turn> = {}): Turn {
  const results = over.results ?? [tierResult()]
  return {
    id: 'turn-1',
    role: 'assistant',
    // The API composes the Turn's text from the course's own tiers (study.py); related
    // courses stay out of it and are shown apart. So does the fixture.
    content: results
      .filter((r) => r.tier !== 'related')
      .map((r) => r.answer)
      .filter(Boolean)
      .join('\n\n'),
    query_type: 'GRAPH_COMPLETION',
    results,
    used_notes: false,
    latency_ms: 1200,
    created_at: AT,
    ...over,
  }
}

export function session(over: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    course: 'cs101',
    owner: 'alice@example.com',
    turns: [],
    created_at: AT,
    ...over,
  }
}

export function askResponse(over: Partial<AskResponse> = {}): AskResponse {
  return { session_id: 'sess-1', turn: assistantTurn(), ...over }
}

export function grillQuestion(
  over: Partial<GrillQuestion> = {},
): GrillQuestion {
  return {
    id: 'q1',
    position: 0,
    kind: 'mcq',
    prompt: 'What resolves a collision?',
    options: ['Chaining', 'Sorting', 'Hashing twice', 'Deleting'],
    page: 3,
    key: {
      answer: 'Chaining',
      explanation: 'Chaining keeps colliding keys in one bucket.',
    },
    given: null,
    ...over,
  }
}

/** What the mock server will write, batch by batch: positions 0-99 belong to batch 0,
 * 100-199 to batch 1. The key is present here; the handler withholds it on the wire while
 * the Grill is open, as the server does, and grades against it on submit. */
export function grill(over: Partial<Grill> = {}): Grill {
  return {
    id: 'grill-1',
    status: 'open',
    material_id: 'm-week1.pdf',
    page_start: 1,
    page_end: 24,
    topic_label: 'week1.pdf',
    score: null,
    questions: [
      grillQuestion(),
      grillQuestion({
        id: 'q2',
        position: 100,
        kind: 'short_answer',
        prompt: 'Define a hash collision.',
        options: null,
        page: 14,
        key: { answer: 'Two keys hash to the same bucket.', explanation: null },
      }),
    ],
    ...over,
  }
}

/** The plan the mock server hands out for any Material: two batches of twelve pages. */
export const GRILL_BATCHES = [
  { index: 0, page_start: 1, page_end: 12 },
  { index: 1, page_start: 13, page_end: 24 },
]
