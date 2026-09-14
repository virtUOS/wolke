import { useMemo } from 'react'
import type { Category, Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { CatalogView } from './CatalogView'
import { type TileActions } from './Tile'

// Search results, grouped by set (issue #171, design option 4c).
//
// The finding behind the issue was that search silently left the view the
// reader was in. The placeholder fix and the app-bar entry point say the search
// is global; this says, per hit, which side of the line it fell on — "FAVORITEN
// · n" first, then "ALLE DIENSTE · n".
//
// The split is by favorite id only. Ranking is the server's, and it stays the
// server's: each group keeps the order /api/search returned, so grouping never
// silently re-sorts a relevance list.
//
// Deliberately its own commit, and its own component, so it can be reverted on
// its own if it doesn't earn its keep: the entry-point move and the placeholder
// fix stand without it.

interface SearchResultsProps {
  /** The server's ranked hits, in rank order. */
  services: Service[]
  favoritedIDs: Set<string>
  categories: Category[]
  locale: string
  layout: 'grid' | 'list'
  actions: TileActions
  /** The zero-result copy ("Keine Dienste für … gefunden"). */
  emptyMessage: string
}

export function SearchResults({
  services,
  favoritedIDs,
  categories,
  locale,
  layout,
  actions,
  emptyMessage,
}: SearchResultsProps) {
  const tr = t(locale)

  const [favorites, others] = useMemo(() => {
    const fav: Service[] = []
    const rest: Service[] = []
    for (const s of services) (favoritedIDs.has(s.id) ? fav : rest).push(s)
    return [fav, rest]
  }, [services, favoritedIDs])

  // No hits at all: the ungrouped empty state, unchanged.
  if (services.length === 0) {
    return (
      <CatalogView
        services={services}
        categories={categories}
        locale={locale}
        layout={layout}
        actions={actions}
        emptyMessage={emptyMessage}
      />
    )
  }

  // An empty group is omitted rather than headed with a "· 0": a heading over
  // nothing is a place the reader looks for something that isn't there. A
  // search that matches no favorites is simply one list, correctly named.
  const groups: Array<[string, Service[]]> = []
  if (favorites.length > 0) groups.push([tr.dash.favorites, favorites])
  if (others.length > 0) groups.push([tr.dash.allServices, others])

  return (
    <>
      {groups.map(([label, list], i) => (
        <section key={label} style={{ marginTop: i === 0 ? 0 : 28 }}>
          <h3
            // Uppercase with wide tracking, per the design — but at 12px, not
            // the design's 10–11px: 12px is the repo's readability floor
            // (docs/03 §2) and the e2e viewport assertions enforce it. `em`
            // tracking so it scales with the size, and text-text-muted so the
            // hits stay the loudest thing in the column.
            className="mb-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-text-muted"
          >
            {tr.dash.searchGroup(label, list.length)}
          </h3>
          <CatalogView
            services={list}
            categories={categories}
            locale={locale}
            layout={layout}
            actions={actions}
          />
        </section>
      ))}
    </>
  )
}
