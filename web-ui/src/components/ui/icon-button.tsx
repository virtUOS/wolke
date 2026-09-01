import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// IconButton — a square, icon-only button (close, back, toolbar actions). Because
// it has no text, an accessible name is mandatory: `aria-label` is required at
// the type level so an unnamed icon button can't compile. Pass a lucide icon as
// the child (marked aria-hidden). Visible focus ring satisfies docs/03 §8.
const iconButtonVariants = cva(
  // shrink-0: a square touch target must not be squeezed narrower than the
  // floor by a tight flex row (a dialog header on a 324px phone did exactly
  // that, leaving a 36×44 close button).
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:cursor-default disabled:opacity-50',
  {
    variants: {
      // ghost tints its own background on hover; plain only shifts the icon
      // colour (for use on already-tinted surfaces like a banner).
      variant: {
        ghost: 'hover:bg-surface hover:text-text',
        plain: 'hover:text-text',
      },
      // Icon-only buttons are the smallest controls in the app, so they carry
      // the 44px phone floor explicitly and shrink to the icon's own box from
      // `md:` up (docs/03 §4, issue #101). A caller that needs a different
      // desktop box overrides h-/w- via className (cn resolves the conflict).
      size: {
        sm: 'h-11 w-11 p-2.5 md:h-7 md:w-7 md:p-1',
        md: 'h-11 w-11 p-2.5 md:h-9 md:w-9 md:p-2',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Required — an icon-only button must have an accessible name. */
  'aria-label': string
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  ),
)
IconButton.displayName = 'IconButton'

export { iconButtonVariants }
