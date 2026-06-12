import { useId, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, FolderPlus, Star } from 'lucide-react'
import { localized, type Category, type Service } from '@/lib/api'
import { iconByName } from '@/lib/icons'
import { cn } from '@/lib/utils'

// TileActions bundles the favorite/launch handlers shared by every tile grid,
// so views pass one object instead of drilling four props.
export interface TileActions {
  favoritedIDs: Set<string>
  onToggleFavorite: (s: Service) => void
  onAddToList: (s: Service) => void
  onLaunch: (s: Service) => void
}

interface TileProps {
  service: Service
  locale: string
  categories: Category[]
  /** When provided, the favorite star is shown (quick-add to the default list). */
  favorited?: boolean
  onToggleFavorite?: (service: Service) => void
  /** When provided, an "add to list…" button opens the deliberate add-to-list flow. */
  onAddToList?: (service: Service) => void
  /** Fired when the launch zone is activated (records a click event). */
  onLaunch?: (service: Service) => void
}

// The two-zone tile (docs/01 §4.2, docs/03 §5): the top zone is a link that
// launches the service (or, for doc-only entries, its documentation) in a new
// tab; the bottom zone toggles the description in place and never navigates.
// Three controls, three roles — so keyboard and screen-reader users get the same
// crisp launch/explore split.
export function Tile({ service, locale, categories, favorited, onToggleFavorite, onAddToList, onLaunch }: TileProps) {
  const [open, setOpen] = useState(false)
  const regionId = useId()

  const Icon = iconByName(service.icon)
  const launchHref = service.service_url || service.doc_url || '#'
  const primaryCategory = categories.find((c) => c.slug === service.categories[0])
  const subLabel = primaryCategory ? localized(primaryCategory.label, locale) : ''
  const description = localized(service.description, locale)

  return (
    <div className="rounded-lg border border-surface bg-bg shadow-sm">
      <div className="relative flex items-start gap-3 p-4">
        {(onToggleFavorite || onAddToList) && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5">
            {onAddToList && (
              <button
                type="button"
                aria-label={`${service.name} zu einer Liste hinzufügen`}
                onClick={() => onAddToList(service)}
                className="rounded-md p-1 text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <FolderPlus className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            {onToggleFavorite && (
              <button
                type="button"
                aria-pressed={favorited}
                aria-label={favorited ? `${service.name} aus Favoriten entfernen` : `${service.name} zu Favoriten hinzufügen`}
                onClick={() => onToggleFavorite(service)}
                className="rounded-md p-1 text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <Star className={cn('h-5 w-5', favorited && 'fill-[var(--primary)] text-primary')} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {/* Top zone = launch. */}
        <a
          href={launchHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onLaunch?.(service)}
          className="group flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <span className="mt-0.5 shrink-0 rounded-md bg-surface p-2 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-text group-hover:text-primary">{service.name}</span>
              {service.doc_only ? (
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-label="Nur Dokumentation" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 group-hover:opacity-100" aria-hidden="true" />
              )}
            </span>
            {subLabel && <span className="block truncate text-sm text-text-muted">{subLabel}</span>}
          </span>
        </a>
      </div>

      {/* Bottom zone = expand/collapse, never navigates. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-surface px-4 py-2 text-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
      >
        {open ? (
          <>
            <ChevronUp className="h-4 w-4" aria-hidden="true" /> Weniger Details
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4" aria-hidden="true" /> Mehr Details
          </>
        )}
      </button>

      {open && (
        <div id={regionId} className="border-t border-surface px-4 py-3 text-sm text-text">
          <p>{description}</p>
          {service.doc_url && !service.doc_only && (
            <a
              href={service.doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" /> Dokumentation
            </a>
          )}
        </div>
      )}
    </div>
  )
}
