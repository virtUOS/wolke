import type { MouseEvent } from 'react'
import { FileText, Star } from 'lucide-react'
import { localized, type Category, type ClickTarget, type Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { ServiceIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'

// TileActions bundles the favorite/launch handlers shared by every tile grid,
// so views pass one object instead of drilling several props.
export interface TileActions {
  favoritedIDs: Set<string>
  onToggleFavorite: (s: Service) => void
  /**
   * `plainClick` is true only for the primary launch link (never the doc
   * link) activated by an ordinary left click — not Ctrl/Cmd/Shift-click, not
   * a middle click. It's the caller's signal for launch-triggered side
   * effects that a deliberate new-tab gesture should skip (issue #27:
   * clearing an active search). Click tracking itself must fire regardless.
   */
  onLaunch: (s: Service, target: ClickTarget | undefined, plainClick: boolean) => void
}

// True only for a click that would open the link in the current context the
// way a plain click does — not a modifier-driven "open in new tab/window"
// gesture (Ctrl/Cmd/Shift-click) and not a middle click (button !== 0;
// middle-click fires `auxclick`, not `click`, so this is here for completeness
// rather than because it's reachable).
function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey
}

// Shared by both layouts below (grid card + mobile list row): the
// hyphenate-compound convention (index.css) wraps a long German compound
// ("Identitätsmanagement") instead of overflowing its box (CLAUDE.md, issue
// #23), but only hyphenates as a last resort rather than a line-filler
// (issue #112).
function TileName({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      className="hyphenate-compound"
      style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.005em', ...style }}
    >
      {children}
    </span>
  )
}

function TileDescription({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="hyphenate-compound"
      style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-muted)' }}
    >
      {children}
    </p>
  )
}

interface TileProps {
  service: Service
  locale: string
  categories: Category[]
  /** When provided, the favorite star is shown. */
  favorited?: boolean
  onToggleFavorite?: (service: Service) => void
  /** Fired when a tile link is activated; target distinguishes the launch link
   *  from the secondary documentation link. */
  onLaunch?: (service: Service, target: ClickTarget | undefined, plainClick: boolean) => void
  /** Desktop = grid (default); mobile = list. */
  layout?: 'grid' | 'list'
}

// Editorial tile (docs/03 §5). The main tile area is a full-coverage <a> that
// opens the service. The star and "Dokumentation" footer link are separate
// interactive elements layered above it via pointer-events. Description is
// always visible — no expand/collapse in the Editorial direction.
export function Tile({ service, locale, categories, favorited, onToggleFavorite, onLaunch, layout = 'grid' }: TileProps) {
  const s = t(locale)
  const launchHref = service.service_url || service.doc_url || '#'
  const docsOnly = service.doc_only
  const primaryCategory = categories.find((c) => c.slug === service.categories[0])
  const categoryLabel = primaryCategory ? localized(primaryCategory.label, locale) : ''
  const description = localized(service.description, locale)
  // The link's accessible name carries everything a sighted user sees: the
  // status badge (Beta/Wartung) and a new-tab warning, not just the name.
  const accessibleLabel = s.tile.open(service.name, docsOnly) + s.tile.status(service.tag) + s.tile.newTab

  const starBtn = onToggleFavorite ? (
    <IconButton
      variant="ghost"
      size="sm"
      // The icon stays 20px; the button around it is a 44px touch target on a
      // phone and collapses back to the icon's own box from `md` up (docs/03 §4).
      className="h-11 w-11 md:h-7 md:w-7"
      aria-label={favorited ? s.tile.removeFav(service.name) : s.tile.addFav(service.name)}
      aria-pressed={favorited}
      style={{ color: favorited ? 'var(--accent)' : 'var(--text-muted)', pointerEvents: 'auto', flexShrink: 0 }}
      onClick={(e) => {
        e.stopPropagation()
        onToggleFavorite(service)
      }}
    >
      <Star className={cn('h-5 w-5', favorited && 'fill-[var(--accent)]')} aria-hidden="true" />
    </IconButton>
  ) : null

  // ── Mobile list row ────────────────────────────────────────────────────────
  if (layout === 'list') {
    return (
      <div className="tile-list-item" style={{ position: 'relative', borderBottom: '1px solid var(--border)' }}>
        <a
          href={launchHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={accessibleLabel}
          onClick={(e) => onLaunch?.(service, undefined, isPlainClick(e))}
          style={{ position: 'absolute', inset: 0 }}
          className="tile-focus-link"
        />
        {/* Two lines, not three columns (issue #99, second round).
            
            The row used to be icon | text | docs | star on one line, so on a
            360px phone the text column was whatever the three fixed 44px blocks
            left over — about 174px, which hyphenated nearly every German word.
            The controls now share the *title* line, where a short service name
            has width to spare, and the description owns the row's full width
            underneath (~338px at 360px). Nothing shrank and nothing grew: the
            same elements, positioned so the text gets the space.
            
            Tuned for 360×800 and 390×844; 324px is the correctness floor, where
            the title takes a second line rather than the description losing its
            column (CLAUDE.md, "Design for the standard phones"). */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            // The horizontal insets are the pre-pass ones: padding here is
            // description width, and this row's problem was width.
            padding: '12px 8px 12px 14px',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              aria-hidden="true"
              style={{
                width: 44, height: 44, borderRadius: 'var(--radius-md)', flexShrink: 0,
                background: 'var(--surface-2)', display: 'grid', placeItems: 'center',
                color: 'var(--text)',
              }}
            >
              <ServiceIcon name={service.icon} className="h-[22px] w-[22px]" aria-hidden="true" />
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <TileName style={{ minWidth: 0 }}>{service.name}</TileName>
              {service.tag === 'beta' && <Badge variant="info">{s.tile.beta}</Badge>}
              {service.tag === 'wartung' && <Badge variant="warning">{s.tile.maintenance}</Badge>}
              {docsOnly && <Badge variant="neutral">{s.tile.docs}</Badge>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, pointerEvents: 'auto' }}>
              {!docsOnly && service.doc_url && (
                <a
                  href={service.doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.tile.docsLink + s.tile.newTab}
                  onClick={(e) => {
                    e.stopPropagation()
                    onLaunch?.(service, 'documentation', false)
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface-2 p-1.5 text-text-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:h-auto md:w-auto"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
              {starBtn}
            </div>
          </div>

          <TileDescription>{description}</TileDescription>
        </div>
      </div>
    )
  }

  // ── Desktop grid card ──────────────────────────────────────────────────────
  return (
    <div
      className="tile-grid"
      style={{
        position: 'relative',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Full-coverage launch link sits behind the content layer. */}
      <a
        href={launchHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={accessibleLabel}
        onClick={(e) => onLaunch?.(service, undefined, isPlainClick(e))}
        style={{ position: 'absolute', inset: 0, borderRadius: 'var(--radius-md)' }}
        className="tile-focus-link"
      />

      {/* Content — pointer-events:none lets clicks fall through to the link
          except on the star and docs-link which re-enable them explicitly. */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 20,
          height: '100%',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      >
        {/* Top row: icon chip + star */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div
            aria-hidden="true"
            style={{
              width: 44, height: 44, borderRadius: 'var(--radius-md)', flexShrink: 0,
              background: 'var(--surface-2)', display: 'grid', placeItems: 'center',
              color: 'var(--text)',
            }}
          >
            <ServiceIcon name={service.icon} className="h-[22px] w-[22px]" aria-hidden="true" />
          </div>
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>{starBtn}</div>
        </div>

        {/* Body: name + badge(s) + description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TileName>{service.name}</TileName>
            {service.tag === 'beta' && <Badge variant="info">{s.tile.beta}</Badge>}
            {service.tag === 'wartung' && <Badge variant="warning">{s.tile.maintenance}</Badge>}
            {docsOnly && <Badge variant="neutral">{s.tile.docs}</Badge>}
          </div>
          <TileDescription>{description}</TileDescription>
        </div>

        {/* Footer: category label + docs link. The label is the flexible half
            (min-width:0 + hyphenate-compound): a long German compound wraps
            inside its own column instead of pushing the docs pill out of the corner —
            uppercase + letter-spacing makes even a 31-character category wider
            than the narrowest grid column (issue #97). The pill never shrinks,
            so it stays anchored at the trailing edge at every viewport. */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginTop: 'auto',
          }}
        >
          <span
            className="text-xs hyphenate-compound"
            style={{
              fontWeight: 600, letterSpacing: '.1em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              flex: '1 1 auto', minWidth: 0,
            }}
          >
            {categoryLabel}
          </span>
          {/* Docs-only tiles already open the documentation via the main link, so
              the secondary docs chip is redundant and omitted. */}
          {!docsOnly && service.doc_url && (
            <a
              href={service.doc_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.tile.docsLink + s.tile.newTab}
              onClick={(e) => {
                e.stopPropagation()
                onLaunch?.(service, 'documentation', false)
              }}
              style={{ pointerEvents: 'auto' }}
              // The grid card is the desktop layout, but it is reachable at
              // phone widths through the admin service form's live preview, so
              // the chip carries the 44px floor like every other control and
              // collapses to its designed box from md: up (issue #101).
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-text-muted no-underline transition-colors hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:min-h-0 md:px-2"
            >
              <FileText className="h-[14px] w-[14px]" aria-hidden="true" />
              {s.tile.docsLink}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
