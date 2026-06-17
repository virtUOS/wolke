// Focus helpers for the hand-rolled overlay primitives (Popover, the account
// menu). They mirror the Dialog's trap so a panel carrying role="dialog" — which
// promises focus containment — actually delivers it for keyboard/AT users.

export const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// focusFirst moves focus to the first focusable inside container, falling back to
// the container itself (which must be tabIndex={-1}) when it holds none.
export function focusFirst(container: HTMLElement | null) {
  if (!container) return
  const items = container.querySelectorAll<HTMLElement>(FOCUSABLE)
  ;(items[0] ?? container).focus()
}

// trapTab keeps Tab / Shift+Tab cycling within container. Call it from a keydown
// handler; it no-ops for non-Tab keys and when focus is mid-list.
export function trapTab(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (items.length === 0) {
    e.preventDefault()
    container.focus()
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
