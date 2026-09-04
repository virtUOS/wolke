import { useLayoutEffect, useRef } from 'react'
import { ArrowUpToLine, ChevronDown, ChevronUp } from 'lucide-react'
import type { FavoritesOrder as Order, Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useTransientAnnouncement } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { OptionGroup } from '@/components/ui/option-group'

// The favorites order controls (issue #125). Two prop-driven pieces:
//
//   FavoritesOrderBar — the mode selector (usage / alpha / manual), plus the
//     explicit "Anordnen" toggle that only exists in manual mode.
//   FavoritesArrange  — the edit mode itself: compact rows with ▲ / ▼ /
//     "an den Anfang", the idiom the admin role-defaults editor established.
//
// No drag & drop, deliberately (see the issue): it is poor on touch and hostile
// to keyboards and screen readers, and buttons are what make "reorder your
// favorites" work for everyone. The writes live in Dashboard; these render.

/** Which action a row's button performs — also the ref key for focus handling. */
type MoveAction = 'up' | 'down' | 'top'

export interface FavoritesOrderBarProps {
  locale: string
  order: Order
  onSetOrder: (next: Order) => void
  /** Whether the arrange edit mode is currently open. */
  arranging: boolean
  onToggleArrange: () => void
  /** False when there is nothing to arrange (no favorites yet). */
  canArrange: boolean
}

export function FavoritesOrderBar({
  locale,
  order,
  onSetOrder,
  arranging,
  onToggleArrange,
  canArrange,
}: FavoritesOrderBarProps) {
  const tr = t(locale)
  return (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
      <span className="shrink-0 text-xs font-medium text-text-muted md:text-[12.5px]">{tr.dash.favOrder}</span>
      {/* min-w-0 so the group shrinks with the column instead of pushing the
          row past a 324px viewport; it wraps between options if it must. */}
      <div className="min-w-0 md:max-w-md md:flex-1">
        <OptionGroup
          label={tr.dash.favOrder}
          value={order}
          onChange={onSetOrder}
          options={
            [
              ['usage', tr.dash.favOrderUsage],
              ['alpha', tr.dash.favOrderAlpha],
              ['manual', tr.dash.favOrderManual],
            ] as const
          }
        />
      </div>
      {/* Only in manual mode: in a computed order there is nothing to arrange,
          and offering the button there would promise something it can't do. */}
      {order === 'manual' && canArrange && (
        <Button
          size="sm"
          variant={arranging ? 'default' : 'outline'}
          aria-pressed={arranging}
          onClick={onToggleArrange}
          className="shrink-0 self-start md:self-auto"
        >
          {arranging ? tr.dash.favArrangeDone : tr.dash.favArrange}
        </Button>
      )}
    </div>
  )
}

export interface FavoritesArrangeProps {
  /** The favorites in their current order — the single source of truth. */
  services: Service[]
  locale: string
  /** Called with the whole new order of service ids after every move. */
  onReorder: (serviceIDs: string[]) => void
}

export function FavoritesArrange({ services, locale, onReorder }: FavoritesArrangeProps) {
  const tr = t(locale)
  const { announcement, announce } = useTransientAnnouncement()

  // The order is not held here: the parent owns it (optimistically, via the
  // favorites cache), so there is no second copy to drift out of sync with the
  // list on screen — and none to reconcile when the server's answer lands.
  const ids = services.map((s) => s.id)
  // The identity of the *order*, for the focus effect below: a new array every
  // render would fire it on every render, and the list itself is what changed.
  const orderKey = ids.join(',')

  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<{ id: string; action: MoveAction } | null>(null)

  // Focus follows the moved row. React re-parents the row's DOM node (the key
  // is the service id), so the button usually keeps focus by itself — but not
  // when the move disables the very button that was pressed, which is exactly
  // what happens on the last step of walking a favorite to an end. Without
  // this, that step drops focus to <body> and a keyboard user starts over.
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    pendingFocus.current = null
    const fallbacks: Record<MoveAction, MoveAction[]> = {
      up: ['up', 'down'],
      down: ['down', 'up'],
      top: ['top', 'down', 'up'],
    }
    for (const action of fallbacks[pending.action]) {
      const el = buttons.current.get(`${pending.id}:${action}`)
      if (el && !el.disabled) {
        el.focus()
        return
      }
    }
  }, [orderKey])

  const move = (from: number, action: MoveAction) => {
    const to = action === 'top' ? 0 : action === 'up' ? from - 1 : from + 1
    if (to < 0 || to >= ids.length || to === from) return
    const next = [...ids]
    next.splice(to, 0, ...next.splice(from, 1))
    pendingFocus.current = { id: ids[from], action }
    announce(tr.dash.favMoved(services[from].name, to + 1, ids.length))
    onReorder(next)
  }

  const registerButton = (id: string, action: MoveAction) => (el: HTMLButtonElement | null) => {
    const key = `${id}:${action}`
    if (el) buttons.current.set(key, el)
    else buttons.current.delete(key)
  }

  if (services.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        {tr.dash.favEmpty}
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-xs text-text-muted">{tr.dash.favArrangeHint}</p>
      <ol className="space-y-1">
        {services.map((s, i) => (
          // flex-wrap, not a fixed row: three 44px targets plus a long German
          // compound do not fit 324px on one line, and wrapping is what keeps
          // the name readable instead of squeezed to a column of letters.
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
          >
            <span className="min-w-0 flex-1 hyphenate-compound">
              {i + 1}. {s.name}
            </span>
            <IconButton
              ref={registerButton(s.id, 'up')}
              size="sm"
              aria-label={`${tr.dash.favMoveUp} – ${s.name}`}
              disabled={i === 0}
              onClick={() => move(i, 'up')}
              className="disabled:opacity-30"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              ref={registerButton(s.id, 'down')}
              size="sm"
              aria-label={`${tr.dash.favMoveDown} – ${s.name}`}
              disabled={i === services.length - 1}
              onClick={() => move(i, 'down')}
              className="disabled:opacity-30"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              ref={registerButton(s.id, 'top')}
              size="sm"
              aria-label={`${tr.dash.favMoveTop} – ${s.name}`}
              disabled={i === 0}
              onClick={() => move(i, 'top')}
              className="disabled:opacity-30"
            >
              <ArrowUpToLine className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ol>
      {/* Polite live region: one message per move, then quiet again — a
          screen-reader user hears where the row landed, which is the only
          feedback a reorder gives (issue #35's empty-at-rest rule applies). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
