import { useLayoutEffect, useId, useRef, useState } from 'react'
import { ArrowUpDown, ArrowUpToLine, ChevronDown, ChevronUp, List as ListIcon } from 'lucide-react'
import type { FavoritesOrder as Order, Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ServiceIcon } from '@/lib/icons'
import { useTransientAnnouncement } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Popover } from '@/components/ui/popover'

// The favorites order controls (issue #125). Two prop-driven pieces:
//
//   FavoritesSortMenu — the compact trigger that sits beside the "Favoriten"
//     heading, opening a popover (desktop) or a bottom sheet (phone) with the
//     order radio group. "Anordnen" appears in it only in manual mode.
//   FavoritesArrange  — the edit mode itself: compact rows with ▲ / ▼ /
//     "an den Anfang", the idiom the admin role-defaults editor established,
//     under its own Abbrechen · Anordnen · Fertig bar.
//
// No drag & drop, deliberately (see the issue): it is poor on touch and hostile
// to keyboards and screen readers, and buttons are what make "reorder your
// favorites" work for everyone. The writes live in Dashboard; these render.

/** Which action a row's button performs — also the ref key for focus handling. */
type MoveAction = 'up' | 'down' | 'top'

const ORDERS: readonly Order[] = ['usage', 'alpha', 'manual']

function orderLabel(tr: ReturnType<typeof t>, order: Order): string {
  return order === 'usage' ? tr.dash.favOrderUsage : order === 'alpha' ? tr.dash.favOrderAlpha : tr.dash.favOrderManual
}

/**
 * The order radio group. Real `<input type="radio">`s, visually hidden inside
 * their own labels: the keyboard behaviour (arrow keys move *and* select, which
 * is exactly "applies immediately"), the group semantics and the accessible
 * names all come from the platform instead of being re-implemented on buttons.
 *
 * Because the input itself is sr-only, its focus ring would render nowhere —
 * so the visible indicator carries it via `peer-focus-visible:` (the bug
 * ChoiceChip fixed for the category chips; not reintroducing that class of it).
 *
 * `dense` is the popover's pointer density; the sheet's rows are the phone
 * sizing (48px rows, 18px indicator, divided).
 */
function OrderRadioGroup({
  locale,
  order,
  onSetOrder,
  dense,
}: {
  locale: string
  order: Order
  onSetOrder: (next: Order) => void
  dense: boolean
}) {
  const tr = t(locale)
  // One radio name per instance, so a popover and a sheet mounted in the same
  // document could never end up in the same radio group.
  const name = useId()
  return (
    <div role="radiogroup" aria-label={tr.dash.favOrder}>
      {ORDERS.map((value) => {
        const active = value === order
        return (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-center rounded-sm transition-colors hover:bg-surface-2',
              dense ? 'gap-2.5 px-2.5 py-[7px] text-[13px]' : 'min-h-12 gap-3.5 px-0.5 text-[15px]',
              !dense && value !== ORDERS[0] && 'border-t border-border',
              active && 'bg-surface-2',
              !dense && 'hover:bg-transparent',
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={active}
              onChange={() => onSetOrder(value)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                'box-border shrink-0 rounded-full transition-colors',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--surface)]',
                dense ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]',
                active
                  ? cn('border-primary', dense ? 'border-[4.5px]' : 'border-[5.5px]')
                  : 'border-[1.5px] border-text-muted',
              )}
            />
            <span className="hyphenate-compound">{orderLabel(tr, value)}</span>
          </label>
        )
      })}
    </div>
  )
}

export interface FavoritesSortMenuProps {
  locale: string
  order: Order
  onSetOrder: (next: Order) => void
  /** Opens the arrange edit mode. Only offered in manual mode. */
  onArrange: () => void
  /** False when there is nothing to arrange (no favorites yet). */
  canArrange: boolean
  /** Phone layout: a bottom sheet instead of the popover. */
  isMobile: boolean
}

export function FavoritesSortMenu({
  locale,
  order,
  onSetOrder,
  onArrange,
  canArrange,
  isMobile,
}: FavoritesSortMenuProps) {
  const tr = t(locale)
  const [sheetOpen, setSheetOpen] = useState(false)
  const active = orderLabel(tr, order)

  // Only in manual mode: in a computed order there is nothing to arrange, and
  // offering the button there would promise something it can't do.
  const showArrange = order === 'manual' && canArrange

  const trigger = (
    <Button
      variant="ghost"
      // The visible label is the active order; the accessible name says what
      // that label *is* (and contains it), so "Häufig genutzt" isn't a button
      // name on its own.
      aria-label={tr.dash.favOrderTrigger(active)}
      className={cn(
        'shrink-0 gap-1.5 rounded-md bg-surface-2 font-normal text-text hover:bg-surface-2/70',
        // 44px touch floor at phone widths (the design's 36px would fail the
        // viewport suite); the designed 30px density from md: up.
        'h-11 px-2.5 text-sm md:h-[30px] md:pl-2.5 md:pr-2 md:text-[13px]',
      )}
    >
      <ArrowUpDown className="h-[15px] w-[15px] shrink-0 md:h-3.5 md:w-3.5" aria-hidden="true" />
      <span className="truncate">{active}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
    </Button>
  )

  const arrangeButton = (
    <Button
      variant="outline"
      onClick={() => {
        setSheetOpen(false)
        onArrange()
      }}
      className={cn(
        'w-full gap-2 border-border',
        isMobile ? 'mt-2.5 h-12 text-[15px]' : 'h-8 text-[13px] md:h-8',
      )}
    >
      <ListIcon className={isMobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden="true" />
      {tr.dash.favArrange}
    </Button>
  )

  if (isMobile) {
    return (
      <>
        {/* The sheet is a modal Dialog, so the trigger owns its own state here
            rather than being cloned by Popover. */}
        <Button
          variant="ghost"
          aria-label={tr.dash.favOrderTrigger(active)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          // min-w-0 rather than shrink-0: on a 324px phone the heading and a
          // long order label ("Eigene Reihenfolge") share one row, so the
          // trigger has to be able to give ground and truncate instead of
          // pushing the row past the viewport.
          className="h-11 min-w-0 gap-1.5 rounded-md bg-surface-2 px-2.5 text-sm font-normal text-text hover:bg-surface-2/70"
        >
          <ArrowUpDown className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          <span className="truncate">{active}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
        </Button>
        <Dialog
          variant="sheet"
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={tr.dash.favOrder}
          closeLabel={tr.common.close}
        >
          <OrderRadioGroup locale={locale} order={order} onSetOrder={onSetOrder} dense={false} />
          {showArrange && arrangeButton}
        </Dialog>
      </>
    )
  }

  return (
    <Popover
      label={tr.dash.favOrder}
      trigger={trigger}
      align="start"
      panelWidth={236}
      panelClassName="mt-2 bg-surface p-0 pb-1.5 pt-3 shadow-[0_12px_32px_rgba(0,0,0,.45)]"
    >
      {/* The design's 10px section label sits below the 12px readability floor
          (docs/03 §2), which the viewport suite enforces — so it ships at the
          floor, uppercase and tracked out as designed. */}
      <p className="px-2.5 pb-2 text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
        {tr.dash.favOrder}
      </p>
      <div className="px-1.5">
        <OrderRadioGroup locale={locale} order={order} onSetOrder={onSetOrder} dense />
        {showArrange && (
          <div className="mx-1 mt-1.5 border-t border-border pt-2">{arrangeButton}</div>
        )}
      </div>
    </Popover>
  )
}

export interface FavoritesArrangeProps {
  /** The favorites in their current order — the single source of truth. */
  services: Service[]
  locale: string
  /** Called with the whole new order of service ids after every move. */
  onReorder: (serviceIDs: string[]) => void
  /** Leave the edit mode, keeping what was arranged. */
  onDone: () => void
  /** Leave the edit mode, restoring the order it was entered with. */
  onCancel: () => void
}

export function FavoritesArrange({ services, locale, onReorder, onDone, onCancel }: FavoritesArrangeProps) {
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

  // What "Abbrechen" restores: the arrangement the screen was entered with.
  // Every move already writes through (there is no draft order to discard), so
  // undoing them is one more write of the remembered list — the same path, not
  // a second ordering mechanism. State with a lazy initialiser, not a ref: it
  // is captured exactly once, on mount, and reading it during render is
  // legitimate (the edit mode is only ever mounted with rows to arrange).
  const [entryOrder] = useState(() => ids)

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

  const cancel = () => {
    if (entryOrder.join(',') !== orderKey) onReorder(entryOrder)
    onCancel()
  }

  const registerButton = (id: string, action: MoveAction) => (el: HTMLButtonElement | null) => {
    const key = `${id}:${action}`
    if (el) buttons.current.set(key, el)
    else buttons.current.delete(key)
  }

  // The Abbrechen · Anordnen · Fertig bar. The side actions share a basis so
  // the title is centred between them, and each stays a real touch target.
  const topBar = (
    <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
      <div className="flex flex-1 basis-0 justify-start">
        <Button variant="ghost" size="sm" onClick={cancel} className="px-2 font-normal text-text-muted">
          {tr.dash.favArrangeCancel}
        </Button>
      </div>
      <h2 className="text-base font-semibold text-text">{tr.dash.favArrange}</h2>
      <div className="flex flex-1 basis-0 justify-end">
        <Button variant="ghost" size="sm" onClick={onDone} className="px-2 font-semibold text-primary">
          {tr.dash.favArrangeDone}
        </Button>
      </div>
    </div>
  )

  if (services.length === 0) {
    return (
      <div>
        {topBar}
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
      </div>
    )
  }

  return (
    <div>
      {topBar}
      <p className="mb-2.5 text-xs text-text-muted">{tr.dash.favArrangeHint}</p>
      <ol className="flex flex-col gap-2.5">
        {services.map((s, i) => (
          // flex-wrap, not a fixed row: three 44px targets plus a long German
          // compound do not fit 324px on one line, and wrapping is what keeps
          // the name readable instead of squeezed to a column of letters.
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-border bg-surface px-3 py-3 text-[15px] md:gap-x-3 md:py-2 md:text-sm"
          >
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-text"
            >
              <ServiceIcon name={s.icon} className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            {/* The position number stays: with buttons rather than a drag
                handle, "where am I now" is the feedback a move gives.

                min-w, not min-w-0: break-word lets a name shrink to almost
                nothing, so with a floor of 0 the flex row never needs to wrap
                and instead squeezes the name into a column of fragments
                ("MySha / re" at 324px). The floor is what makes the button
                group wrap to its own line at the narrowest width instead —
                the text column must not pay for the fixed-width controls
                (CLAUDE.md, "Responsive & viewport discipline"). */}
            <span className="min-w-24 flex-1 hyphenate-compound font-medium">
              <span className="mr-1.5 font-normal text-text-muted">{i + 1}.</span>
              {s.name}
            </span>
            <span className="flex shrink-0 items-center gap-1">
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
            </span>
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
