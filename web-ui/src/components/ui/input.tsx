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
      'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-muted',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
