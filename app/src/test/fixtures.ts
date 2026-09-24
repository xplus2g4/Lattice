import type {
  AskResponse,
  Citation,
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
  return {
    course: 'cs101',
    filename: 'week1.pdf',
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
