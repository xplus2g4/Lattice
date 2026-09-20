import type { ReactNode } from 'react'

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-lattice-muted">{children}</p>
}
