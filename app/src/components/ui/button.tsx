import type { ButtonHTMLAttributes } from 'react'

import { cx } from './cx'

type ButtonVariant = 'primary' | 'secondary' | 'quiet'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        'inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lattice-violet disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' &&
          'bg-lattice-violet text-white hover:bg-lattice-violet-dark',
        variant === 'secondary' &&
          'border border-lattice-border bg-lattice-surface text-lattice-ink hover:bg-lattice-subtle',
        variant === 'quiet' &&
          'text-lattice-muted hover:bg-lattice-subtle hover:text-lattice-ink',
        className,
      )}
      {...props}
    />
  )
}
