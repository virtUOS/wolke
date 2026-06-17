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
  const active = document.activeElement as HTMLElement | null
  // Focus sits on the container itself (the tabIndex=-1 fallback) or otherwise
  // outside the trapped set — pull it back in rather than letting Tab escape.
  if (!active || !items.includes(active)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}
