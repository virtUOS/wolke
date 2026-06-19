import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusFirst, trapTab } from '@/lib/focus'
import { IconButton } from './icon-button'

// Popover — an icon-triggered floating panel (hand-rolled, no Radix). Used for
// "click a control, get a small panel" cases whose panels hold form controls, so
// it carries role="dialog" (a menu/menuitem pattern would be wrong here).
//
// It is a NON-MODAL, focus-managed disclosure: focus moves into the panel on
// open and Tab is trapped within it (focus.ts), Escape returns focus to the
// trigger, outside-click dismisses, and aria-haspopup/expanded/controls are
// wired. It does NOT make the rest of the page inert (no aria-modal / inert) —
// appropriate for a small settings panel, not a blocking modal; use Dialog for
// content that must own the whole screen.
interface PopoverProps {
  /** Accessible name for the icon trigger and the panel. */
  label: string
  /** The trigger's icon (marked aria-hidden by the caller). */
  icon: React.ReactNode
  children: React.ReactNode
  /** Which edge the panel aligns to. */
  align?: 'start' | 'end'
  /** Extra classes for the panel (e.g. a width). */
  panelClassName?: string
}

export function Popover({ label, icon, children, align = 'end', panelClassName }: PopoverProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const panelId = React.useId()

  React.useEffect(() => {
    if (!open) return
    // role="dialog" promises focus containment: move focus into the panel on
    // open and trap Tab within it (Escape/outside-click still dismiss).
    focusFirst(panelRef.current)
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      trapTab(e, panelRef.current)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        ref={triggerRef}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </IconButton>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cn(
            'absolute z-20 mt-1 rounded-md border border-border bg-bg p-3 text-sm shadow-lg focus:outline-hidden',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
