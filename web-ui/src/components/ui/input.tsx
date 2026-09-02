import * as React from 'react'
import { cn } from '@/lib/utils'

// Input — the standard single-line text field the forms share. Styled from the
// tokens (docs/03 §2); an aria-invalid input borders and rings in danger so
// validation reads visually as well as to assistive tech. The Field primitive
// (label + error wiring) composes this; used bare it still works.
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      // min-h-11 + roomier padding at phone widths (the 44px touch floor,
      // docs/03 §4); the denser box returns from md: up.
      'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted',
      'min-h-11 md:min-h-0 md:px-2 md:py-1.5',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
