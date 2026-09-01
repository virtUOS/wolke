import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Minimal shadcn/ui-style Button to prove the primitive pipeline. The full
// component set is added as features need them (CLAUDE.md: shadcn over
// hand-rolled). Visible focus ring satisfies the a11y floor (docs/03 §8).
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-default disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-white hover:bg-primary-hover',
        outline: 'border border-surface hover:bg-surface',
        ghost: 'hover:bg-surface',
      },
      // Every size meets the 44px touch floor at phone widths and falls back to
      // the pointer density from `md:` up — the shared convention across the
      // primitives (docs/03 §4, issue #101). `md:` is the app's one
      // mobile/desktop breakpoint (src/lib/breakpoints.ts).
      size: {
        default: 'h-11 px-4 py-2 md:h-10',
        sm: 'h-11 px-3 md:h-9',
        icon: 'h-11 w-11 md:h-10 md:w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type, ...props }, ref) => (
    // Default to type="button" so a Button placed in a <form> never submits by
    // accident; callers opt into submission with type="submit".
    <button ref={ref} type={type ?? 'button'} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'

export { buttonVariants }
