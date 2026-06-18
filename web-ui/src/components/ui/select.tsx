import * as React from 'react'
import { cn } from '@/lib/utils'

// Select — a styled native <select>. The app's selects are small enum pickers
// (severity, audience, role), where the native control is fully accessible and
// the boring-simple choice (CLAUDE.md). If a custom-rendered listbox is ever
// needed, that's the point to reach for a Radix Select — this stays the default.
// Token-styled with the same aria-invalid danger affordance as Input.
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 rounded-md border border-border bg-surface px-2 text-sm text-text',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger',
      className,
    )}
    {...props}
  />
))
Select.displayName = 'Select'
