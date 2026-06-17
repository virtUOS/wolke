import { FileText, Star } from 'lucide-react'
import { localized, type Category, type Service } from '@/lib/api'
import { iconByName } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'

// TileActions bundles the favorite/launch handlers shared by every tile grid,
// so views pass one object instead of drilling several props.
export interface TileActions {
  favoritedIDs: Set<string>
  onToggleFavorite: (s: Service) => void
  onLaunch: (s: Service) => void
}

interface TileProps {
  service: Service
  locale: string
  categories: Category[]
  /** When provided, the favorite star is shown. */
  favorited?: boolean
  onToggleFavorite?: (service: Service) => void
  /** Fired when the main launch link is activated. */
  onLaunch?: (service: Service) => void
  /** Desktop = grid (default); mobile = list. */
  layout?: 'grid' | 'list'
}

// Editorial tile (docs/03 §5). The main tile area is a full-coverage <a> that
// opens the service. The star and "Dokumentation" footer link are separate
// interactive elements layered above it via pointer-events. Description is
// always visible — no expand/collapse in the Editorial direction.
export function Tile({ service, locale, categories, favorited, onToggleFavorite, onLaunch, layout = 'grid' }: TileProps) {
  const Icon = iconByName(service.icon)
  const launchHref = service.service_url || service.doc_url || '#'
  const docsOnly = service.doc_only
  const primaryCategory = categories.find((c) => c.slug === service.categories[0])
  const categoryLabel = primaryCategory ? localized(primaryCategory.label, locale) : ''
  const description = localized(service.description, locale)
  const accessibleLabel = `${service.name}${docsOnly ? ' – Dokumentation öffnen' : ' öffnen'}`

  const starBtn = onToggleFavorite ? (
    <IconButton
      variant="ghost"
      size="sm"
      aria-label={favorited ? `${service.name} aus Favoriten entfernen` : `${service.name} zu Favoriten hinzufügen`}
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
          onClick={() => onLaunch?.(service)}
          style={{ position: 'absolute', inset: 0 }}
          className="tile-focus-link"
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 14px',
            pointerEvents: 'none',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 40, height: 40, borderRadius: 'var(--radius-md)', flexShrink: 0,
              background: 'var(--surface-2)', display: 'grid', placeItems: 'center',
              color: 'var(--text)',
            }}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.005em' }}>
                {service.name}
              </span>
              {service.tag === 'beta' && <Badge variant="info">Beta</Badge>}
              {service.tag === 'wartung' && <Badge variant="warning">Wartung</Badge>}
              {docsOnly && <Badge variant="neutral">Dokumentation</Badge>}
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              {description}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, pointerEvents: 'auto' }}>
            {!docsOnly && service.doc_url && (
              <a
                href={service.doc_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Dokumentation"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
            {starBtn}
          </div>
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
        onClick={() => onLaunch?.(service)}
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
            <Icon className="h-[22px] w-[22px]" />
          </div>
          <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>{starBtn}</div>
        </div>

        {/* Body: name + badge(s) + description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.005em' }}>
              {service.name}
            </span>
            {service.tag === 'beta' && <Badge variant="info">Beta</Badge>}
            {service.tag === 'wartung' && <Badge variant="warning">Wartung</Badge>}
            {docsOnly && <Badge variant="neutral">Dokumentation</Badge>}
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
            {description}
          </p>
        </div>

        {/* Footer: category label + docs link */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginTop: 'auto',
          }}
        >
          <span
            style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '.1em',
              textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap',
            }}
          >
            {categoryLabel}
          </span>
          {docsOnly ? (
            <FileText className="h-[15px] w-[15px] shrink-0 text-text-muted" aria-hidden="true" />
          ) : (
            service.doc_url && (
              <a
                href={service.doc_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  pointerEvents: 'auto',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12.5, fontWeight: 600,
                  color: 'var(--text-muted)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
                }}
                className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded"
              >
                <FileText className="h-[14px] w-[14px]" aria-hidden="true" />
                Dokumentation
              </a>
            )
          )}
        </div>
      </div>
    </div>
  )
}
