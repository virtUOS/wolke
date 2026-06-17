import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

// Dialog — a modal, hand-rolled (no Radix yet). It implements the behaviours a
// Radix Dialog would give us so it can be swapped to one later WITHOUT changing
// callers: portal to <body>, role="dialog" + aria-modal, aria-labelledby/
// describedby, focus moved in on open and restored on close, a focus trap on Tab,
// Escape and overlay-click to dismiss, and body scroll-lock. Controlled via
// `open` / `onOpenChange`, mirroring Radix's prop names.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  /** Footer actions (buttons), right-aligned below the body. */
  footer?: React.ReactNode
  /** Accessible name for the close (X) button; pass a localized string. */
  closeLabel?: string
  className?: string
}

export function Dialog({ open, onOpenChange, title, description, children, footer, closeLabel, className }: DialogProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descId = React.useId()

  React.useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const content = contentRef.current
    const focusables = () => Array.from(content?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    ;(focusables()[0] ?? content)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange(false)
        return
      }
      if (e.key !== 'Tab' || !content) return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        content.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onOpenChange])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={() => onOpenChange(false)} />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full max-w-lg rounded-lg border border-border bg-bg p-5 shadow-lg focus:outline-none',
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton aria-label={closeLabel ?? 'Schließen'} size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
