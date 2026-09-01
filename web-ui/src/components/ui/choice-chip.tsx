import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// ChoiceChip — a chip-shaped checkbox or radio: the real control is visually
// hidden inside the chip's own label, so the chip *is* the control (keyboard,
// focus ring and accessible name all come from the native input) rather than a
// button pretending to be one.
//
// Like Checkbox, the label carries the 44px touch floor and hands back to the
// designed density at md: — a chip cannot be its own target at text size
// (issue #101).
const choiceChipVariants = cva(
  'inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 py-1 text-sm transition-colors md:min-h-0 md:px-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]',
  {
    variants: {
      active: {
        true: 'border-primary bg-primary text-white',
        false: 'border-border text-text-muted hover:border-primary hover:text-text',
      },
    },
    defaultVariants: { active: false },
  },
)

export interface ChoiceChipProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>,
    VariantProps<typeof choiceChipVariants> {
  /** The visible label. Rendered as given — localisation happens upstream. */
  label: React.ReactNode
  /** 'checkbox' for a multi-select set, 'radio' for a single-choice set. */
  type: 'checkbox' | 'radio'
  /** Classes for the chip itself (the label element). */
  className?: string
}

export const ChoiceChip = React.forwardRef<HTMLInputElement, ChoiceChipProps>(
  ({ className, active, label, type, ...props }, ref) => (
    <label className={cn(choiceChipVariants({ active }), className)}>
      <input ref={ref} type={type} className="sr-only" {...props} />
      {label}
    </label>
  ),
)
ChoiceChip.displayName = 'ChoiceChip'

export { choiceChipVariants }
