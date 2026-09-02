import * as React from 'react'
import { cn } from '@/lib/utils'

// Checkbox — a styled native checkbox with its label, as one control. The label
// is part of the primitive on purpose: a bare 16px box can never meet the 44px
// touch floor without looking absurd, so the *label* is the hit area (min-h-11
// at phone widths, compact from md: up) and the box sits inside it. That is the
// same trick the viewport suite measures — a padded click-target parent around
// an undersized control (issue #101).
//
// Presentational like the rest of the set: the caller passes an already
// localized label and owns the state.
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** The visible label. Rendered as given — localisation happens upstream. */
  label: React.ReactNode
  /** Classes for the wrapping label (layout); `className` styles the box. */
  labelClassName?: string
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, labelClassName, label, ...props }, ref) => (
    <label
      className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-0', labelClassName)}
    >
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'h-5 w-5 shrink-0 cursor-pointer accent-[var(--primary)] md:h-4 md:w-4',
          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {label}
    </label>
  ),
)
Checkbox.displayName = 'Checkbox'
