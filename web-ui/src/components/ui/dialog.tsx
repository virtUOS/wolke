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
//
// Two shapes, same behaviour set:
//   'center' — the default card, centred in the viewport, titled header + ✕.
//   'sheet'  — a bottom sheet for phone-width pickers: full width, anchored to
//              the bottom edge, its title rendered as a small section label and
//              its drag handle doubling as the close control. The handle is a
//              real, `closeLabel`-named button on purpose: a scrim tap has no
//              accessible name and phones have no Escape key, so without it a
//              screen-reader user on a touch device has no way out.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  /** Footer actions (buttons), right-aligned below the body (stacked in a sheet). */
  footer?: React.ReactNode
  /** Accessible name for the close control; pass a localized string. */
  closeLabel?: string
  /** 'center' (default) is the modal card; 'sheet' is the bottom sheet. */
  variant?: 'center' | 'sheet'
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel,
  variant = 'center',
  className,
}: DialogProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descId = React.useId()
  const isSheet = variant === 'sheet'

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
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center',
        isSheet ? 'items-end' : 'items-center p-4',
      )}
    >
      <div
        className={cn('absolute inset-0', isSheet ? 'bg-black/55' : 'bg-black/40')}
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full border-border bg-bg shadow-lg focus:outline-hidden',
          isSheet
            ? // pb keeps the last row clear of the home indicator on a phone.
              'rounded-t-lg border-t bg-surface px-4 pt-2.5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,.5)]'
            : 'max-w-lg rounded-lg border p-5',
          className,
        )}
      >
        {isSheet ? (
          <>
            {/* The drag handle IS the close button: the 36×4px bar the design
                asks for, inside a full-width 44px hit area (the touch floor),
                with the accessible name a scrim tap can never have. */}
            <button
              type="button"
              aria-label={closeLabel ?? 'Schließen'}
              onClick={() => onOpenChange(false)}
              className="-mt-1.5 flex h-11 w-full cursor-pointer items-center justify-center rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <span className="h-1 w-9 rounded-sm bg-border" aria-hidden="true" />
            </button>
            {/* text-xs, not smaller: 12px is the readability floor (docs/03 §2)
                that the viewport suite measures. */}
            <h2
              id={titleId}
              className="px-0.5 pb-1 text-xs font-medium uppercase tracking-[0.1em] text-text-muted"
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="px-0.5 pb-2 text-sm text-text-muted">
                {description}
              </p>
            )}
          </>
        ) : (
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
        )}
        {children}
        {footer && (
          <div className={cn('mt-5', isSheet ? 'flex flex-col gap-2' : 'flex justify-end gap-2')}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
