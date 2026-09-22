import type { IngestStatus } from '#/lib/api'

export const inputClass = 'rounded border border-gray-300 px-2 py-1 text-sm'
export const buttonClass =
  'rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50'

export interface Scope {
  course: string
  user: string
}

export function pollWhilePending<T extends { status: IngestStatus }>(
  items: Array<T> | undefined,
) {
  return items?.some((i) => i.status === 'queued' || i.status === 'cognifying')
    ? 2000
    : false
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p className="text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

const statusColor: Record<IngestStatus, string> = {
  queued: 'bg-gray-200 text-gray-800',
  cognifying: 'bg-yellow-200 text-yellow-900',
  ready: 'bg-green-200 text-green-900',
  failed: 'bg-red-200 text-red-900',
}

export function StatusBadge({ status }: { status: IngestStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${statusColor[status]}`}>
      {status}
    </span>
  )
}
