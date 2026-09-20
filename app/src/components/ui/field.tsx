import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import { cx } from './cx'

const fieldClass =
  'w-full rounded-lg border border-lattice-border bg-lattice-surface px-3 py-2 text-sm text-lattice-ink outline-none placeholder:text-lattice-muted focus:border-lattice-violet focus:ring-2 focus:ring-lattice-violet-soft disabled:cursor-not-allowed disabled:bg-lattice-subtle'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldClass, className)} {...props} />
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldClass, className)} {...props} />
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(fieldClass, className)} {...props} />
}

export function FieldLabel({
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx(
        'flex flex-col gap-1.5 text-sm font-medium text-lattice-ink',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  )
}
