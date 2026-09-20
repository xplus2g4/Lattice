import type { ReactNode } from 'react'

import { cx } from './cx'

export function Panel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cx(
        'rounded-3xl border border-lattice-border bg-lattice-surface',
        className,
      )}
    >
      {children}
    </section>
  )
}
