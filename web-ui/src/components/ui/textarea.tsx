import * as React from 'react'
import { cn } from '@/lib/utils'

// Textarea — the multi-line counterpart to Input, same token styling and
// aria-invalid danger affordance. Composes under Field like Input does.
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      // Same phone padding as Input, so a form's fields line up (docs/03 §4).
      'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted',
      'md:px-2 md:py-1.5',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
