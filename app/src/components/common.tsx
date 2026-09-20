import type { ReactNode } from 'react'
import type { IngestStatus } from '#/lib/api'

export const inputClass = 'field'
export const buttonClass = 'button button-primary'

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
    <p className="error-line" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

export function StatusBadge({ status }: { status: IngestStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span />
      {status}
    </span>
  )
}

const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  book: 'M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1Z M12 5v15',
  file: 'M14 2H5v20h14V7Z M14 2v6h5 M8 12h8 M8 16h6',
  note: 'M12 3H4v18h16v-8 M9 15l1-5L19 1l4 4-9 9Z',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  lock: 'M6 10h12v11H6Z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',
  close: 'm6 6 12 12 M6 18 18 6',
  graph:
    'M6 6l12 3-6 10Z M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M21 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M14 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  check: 'm5 12 4 4L19 6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
} as const

export function Icon({
  name,
  size = 18,
}: {
  name: keyof typeof paths
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="grid" size={19} />
      </span>
      Lattice<span className="brand-dot">.</span>
    </span>
  )
}

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </header>
  )
}

export function EmptyState({
  title,
  children,
  icon = 'book',
}: {
  title: string
  children: ReactNode
  icon?: keyof typeof paths
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  )
}
