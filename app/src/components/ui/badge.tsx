import type { ReactNode } from 'react'

import { cx } from './cx'

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: BadgeTone
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-lattice-subtle text-lattice-muted',
    info: 'bg-lattice-violet-soft text-lattice-violet-dark',
    success: 'bg-emerald-50 text-lattice-success',
    warning: 'bg-amber-50 text-lattice-warning',
    danger: 'bg-rose-50 text-lattice-danger',
  }

  return (
    <span
      className={cx(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}
