import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// IconButton — a square, icon-only button (close, back, toolbar actions). Because
// it has no text, an accessible name is mandatory: `aria-label` is required at
// the type level so an unnamed icon button can't compile. Pass a lucide icon as
// the child (marked aria-hidden). Visible focus ring satisfies docs/03 §8.
const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      // ghost tints its own background on hover; plain only shifts the icon
      // colour (for use on already-tinted surfaces like a banner).
      variant: {
        ghost: 'hover:bg-surface hover:text-text',
        plain: 'hover:text-text',
      },
      size: { sm: 'p-1', md: 'p-2' },
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
