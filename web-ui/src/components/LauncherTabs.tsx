import type { ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Tab } from '@/lib/view-url'

// The launcher's view switch (issue #170): an underline tab row sitting
// directly above the service list, carrying each set's item count, with the
// favorites sort control on its right.
//
// It replaces the Favoriten/Dienste pills that used to live in the app bar —
// the switch was far from the list it controls, and further still whenever an
// announcement pushed the list down.
//
// *Navigation, not a tablist.* The design asked for role="tablist"/"tab"/
// aria-selected; these stay plain buttons with aria-current, as the pills were
// (TopBar, issue #29): switching changes the URL and pushes a history entry,
// which is navigation rather than in-page panel switching. role="tab" is also a
// promise of Left/Right arrow-key navigation, and claiming it without the full
// APG pattern behind it is worse for screen-reader users than this is.

interface LauncherTabsProps {
  locale: string
  /** The active section, or null while a search is active — search results are
   *  their own (global) view, so neither tab is current then. */
  tab: Tab | null
  onTab: (next: Tab) => void
  /** Item counts for the full visible sets, after beta/visibility narrowing and
   *  before any filter. Undefined until the data is there, so the row doesn't
   *  flash a "0" on first paint. */
  favCount?: number
  allCount?: number
  /** The favorites sort control. Favorites-only: its slot keeps its size on the
   *  Alle Dienste tab so the tabs don't shift when it goes. */
  sort?: ReactNode
  isMobile: boolean
}

export function LauncherTabs({ locale, tab, onTab, favCount, allCount, sort, isMobile }: LauncherTabsProps) {
  const tr = t(locale)
  return (
    <nav
      aria-label={tr.dash.viewNav}
      // items-end so both the tabs and the sort control sit on the row's
      // hairline; the hairline itself is what the active underline sits on.
      className={cn(
        'flex items-end justify-between gap-3 border-b border-border',
        isMobile ? 'mb-3.5' : 'mb-4',
      )}
    >
      {/* 24px between the two labels on a desktop. At 324px the row also has to
          hold "Alle Dienste 38" and the sort button, so the gap gives ground
          first (the issue's viewport note) — never the document width. */}
      <div className="flex min-w-0 items-end gap-4 md:gap-6">
        <TabButton
          label={tr.dash.favorites}
          count={favCount}
          active={tab === 'favoriten'}
          onClick={() => onTab('favoriten')}
          isMobile={isMobile}
        />
        <TabButton
          label={tr.dash.allServices}
          count={allCount}
          active={tab === 'dienste'}
          onClick={() => onTab('dienste')}
          isMobile={isMobile}
        />
      </div>
      {/* Reserved slot: fixed height whether or not it holds the sort control,
          so switching tabs never changes the row's height (issue #170,
          settled decision 3).

          Aligned OPTICALLY (issue #182): a control at the edge of a layout
          reads as flush when its visible edge — not its box — lands on the
          line the content below it ends on. Which edge is visible differs per
          layout, so the compensation does too. The desktop trigger is a filled
          chip (bg-surface-2), so its box IS the visible edge and sits flush
          with the hairline's end and the card grid, no shift; measured at
          1280, pulling the chevron flush instead left the chip 8px past both.
          The phone trigger is a transparent 44px icon button, and the line its
          icon has to meet is the list rows' star column, which the rows inset
          by their own 8px padding (Tile, list layout) — so the slot is pushed
          in by that much and the icon sits centred on the stars. The box
          moves; it never shrinks, so the 44px target survives. */}
      <div
        data-sort-slot=""
        className={cn('flex shrink-0 items-center', isMobile ? 'mr-2 h-11' : 'h-9')}
      >
        {sort}
      </div>
    </nav>
  )
}

function TabButton({
  label,
  count,
  active,
  onClick,
  isMobile,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  isMobile: boolean
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        // The underline is a 2px bottom border pulled onto the row's hairline;
        // it is transparent when inactive so the label never moves between
        // states. Brand red here and on the focus ring only.
        //
        // inline-block rather than a flex box: the count is separated from the
        // label by a real space, so the button's accessible name reads
        // "Favoriten 4" — a flex gap would leave a screen reader with
        // "Favoriten4".
        '-mb-px inline-block shrink-0 cursor-pointer whitespace-nowrap border-b-2 bg-transparent',
        'text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
        // 44px of touch target at phone widths (docs/03 §4), built out of
        // padding rather than a height so the label still sits 8px above the
        // underline: 14 + 20 (text-sm) + 8 + the 2px border. Desktop keeps the
        // designed density.
        isMobile ? 'pb-2 pt-3.5' : 'pb-2',
        active ? 'border-primary font-semibold text-text' : 'border-transparent font-normal text-text-muted hover:text-text',
      )}
    >
      {label}
      {count !== undefined && (
        <>
          {' '}
          <span className="font-normal text-text-muted">{count}</span>
        </>
      )}
    </button>
  )
}
