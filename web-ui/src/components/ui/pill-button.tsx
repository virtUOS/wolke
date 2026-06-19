import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// PillButton — the rounded segment button used for tabs, mode switches, and the
// role selector: filled brand when active, quiet otherwise. It carries only the
// visual active state; the caller sets the semantics (aria-current="page" for a
// nav tab, aria-pressed for a toggle) by spreading the matching ARIA prop.
const pillButtonVariants = cva(
  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
  {
    variants: {
      active: {
        true: 'bg-primary text-white',
        false: 'text-text-muted hover:bg-surface hover:text-text',
      },
    },
    defaultVariants: { active: false },
  },
)

export interface PillButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillButtonVariants> {}

export const PillButton = React.forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ className, active, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(pillButtonVariants({ active }), className)} {...props} />
  ),
)
PillButton.displayName = 'PillButton'

export { pillButtonVariants }
