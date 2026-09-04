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
//
// The trigger comes in two shapes, exactly one of which a caller picks:
//   `icon`    — the built-in icon-only IconButton, named by `label`.
//   `trigger` — a button element of the caller's own (a labelled Button, say),
//               cloned with the ref and the ARIA wiring. This is Radix's
//               `<Popover.Trigger asChild>` shape, so the swap to Radix later
//               still doesn't touch callers. The element must forward refs to
//               its underlying <button> (Button and IconButton do).
interface PopoverBaseProps {
  /** Accessible name for the panel (and for the built-in icon trigger). */
  label: string
  children: React.ReactNode
  /** Which edge the panel aligns to. */
  align?: 'start' | 'end'
  /**
   * The panel's width in px. Worth passing for `align="start"`: the panel is
   * absolutely positioned, so a left-aligned one wider than its trigger sticks
   * out to the right of the anchor, and this reserves that width on the anchor
   * so it doesn't. That is not cosmetic — an out-of-flow child past its
   * positioned ancestor's content edge is exactly what the viewport suite
   * measures as clipped content (e2e/helpers/rules.ts), and it is also what
   * would genuinely clip inside any scrolling ancestor. An `align="end"` panel
   * extends leftwards instead and needs nothing (the account menu's shape).
   * The anchor only ever *reserves* space in a row that has slack; it never
   * moves the trigger, which stays at the anchor's start edge.
   */
  panelWidth?: number
  /** Extra classes for the panel (e.g. padding). */
  panelClassName?: string
}

/** A button element Popover can clone: it must accept a ref to its <button>. */
type TriggerElement = React.ReactElement<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> }
>

type PopoverProps = PopoverBaseProps &
  (
    | {
        /** The trigger's icon (marked aria-hidden by the caller). */
        icon: React.ReactNode
        trigger?: never
      }
    | { trigger: TriggerElement; icon?: never }
  )

export function Popover({ label, icon, trigger, children, align = 'end', panelWidth, panelClassName }: PopoverProps) {
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

  // The wiring both trigger shapes share. A cloned trigger keeps its own
  // onClick (it runs first), so a caller can still react to the press.
  const toggle = () => setOpen((o) => !o)
  const ariaProps = {
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      style={panelWidth !== undefined && align === 'start' ? { minWidth: panelWidth } : undefined}
    >
      {trigger ? (
        React.cloneElement(trigger, {
          ref: triggerRef,
          ...ariaProps,
          onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
            trigger.props.onClick?.(e)
            toggle()
          },
        })
      ) : (
        <IconButton ref={triggerRef} aria-label={label} title={label} {...ariaProps} onClick={toggle}>
          {icon}
        </IconButton>
      )}
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          style={panelWidth !== undefined ? { width: panelWidth } : undefined}
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
