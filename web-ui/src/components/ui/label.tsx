import * as React from 'react'
import { cn } from '@/lib/utils'

// Label — a styled <label>. Associate it with its control via htmlFor (the Field
// primitive does this for you). Mirrors the API a Radix Label would expose, so it
// can be swapped to one later without touching callers.
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('block text-sm font-medium text-text', className)} {...props} />
))
Label.displayName = 'Label'
