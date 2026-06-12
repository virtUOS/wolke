import { localized, type Category, type Service } from '@/lib/api'
import { Tile, type TileActions } from './Tile'

interface CatalogViewProps {
  services: Service[]
  categories: Category[]
  locale: string
  view: 'list' | 'table'
  actions?: TileActions
}

// CatalogView groups services by category (in category sort order) and renders
// them as a single column (list) or a multi-column grid (table) — docs/01 §4.3.
// A service in several categories appears under each.
export function CatalogView({ services, categories, locale, view, actions }: CatalogViewProps) {
  const groups = categories
    .map((c) => ({ category: c, services: services.filter((s) => s.categories.includes(c.slug)) }))
    .filter((g) => g.services.length > 0)

  if (services.length === 0) {
    return <p className="text-sm text-text-muted">Keine Dienste gefunden.</p>
  }

  const grid = view === 'table' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3'

  return (
    <div className="space-y-8">
      {groups.map(({ category, services: svcs }) => (
        <section key={category.slug} aria-labelledby={`cat-${category.slug}`}>
          <h2 id={`cat-${category.slug}`} className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            <span aria-hidden="true" className="inline-block h-4 w-1 rounded bg-primary" />
            {localized(category.label, locale)}
          </h2>
          <div className={grid}>
            {svcs.map((s) => (
              <Tile
                key={`${category.slug}-${s.id}`}
                service={s}
                categories={categories}
                locale={locale}
                favorited={actions?.favoritedIDs.has(s.id)}
                onToggleFavorite={actions?.onToggleFavorite}
                onLaunch={actions?.onLaunch}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
