import type {
  AskResponse,
  Evidence,
  Material,
  Note,
  Session,
  TierResult,
  Turn,
} from '#/lib/api'

// Typed as the generated contract types on purpose (ADR 0005): a response model that
// changes on the server regenerates `src/lib/generated/` and fails `npm run typecheck`
// here, so the mocks cannot drift into a parallel hand-written shape.

const AT = '2026-01-01T00:00:00.000Z'

export function material(over: Partial<Material> = {}): Material {
  return {
    course: 'cs101',
    filename: 'week1.pdf',
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
    status: 'ready',
    error: null,
    updated_at: AT,
    ...over,
  }
}

export function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    kind: 'segment',
    dataset_id: null,
    data_id: null,
    chunk_id: 'chunk-1',
    chunk_index: 3,
    document_name: 'week1.pdf',
    label: null,
    relationship_name: null,
    ...over,
  }
}

export function tierResult(over: Partial<TierResult> = {}): TierResult {
  return {
    tier: 'course',
    dataset_name: 'cs101-global',
    answer: 'A hash table maps keys to buckets.',
    evidence: [evidence()],
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
  return {
    id: 'turn-1',
    role: 'assistant',
    content: '',
    query_type: 'GRAPH_COMPLETION',
    results: [tierResult()],
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
