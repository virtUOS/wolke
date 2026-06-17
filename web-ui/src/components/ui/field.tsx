import * as React from 'react'
import { cn } from '@/lib/utils'
import { Label } from './label'

// Field — a labelled form control with optional hint and error. It owns the
// label↔control association and the ARIA error wiring so callers don't repeat it:
// it injects `id`, `aria-invalid`, and `aria-describedby` into its single child
// control. Pass any control that accepts those props (Input, native select,
// textarea). This is the layout/association contract; swapping the inner Label to
// Radix later is internal.
interface FieldProps {
  label: React.ReactNode
  /** Error message; when set, the control is marked invalid and described by it. */
  error?: React.ReactNode
  /** Optional helper text shown below the control. */
  hint?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactElement<{
    id?: string
    'aria-invalid'?: boolean
    'aria-describedby'?: string
    'aria-required'?: boolean
  }>
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const generatedId = React.useId()
  // A caller-set id on the control wins, mirroring the aria-* merge below, so
  // Field never silently clobbers an explicit id.
  const id = children.props.id ?? generatedId
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy =
    [error ? errorId : null, hint ? hintId : null, children.props['aria-describedby']]
      .filter(Boolean)
      .join(' ') || undefined

  const control = React.cloneElement(children, {
    id,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-describedby': describedBy,
    'aria-required': required ? true : children.props['aria-required'],
  })

  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </Label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
