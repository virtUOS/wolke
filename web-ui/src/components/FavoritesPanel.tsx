import type { Category, Service } from '@/lib/api'
import { CatalogView } from './CatalogView'
import { Tile, type TileActions } from './Tile'

interface FavoritesPanelProps {
  favorites: Service[]
  frequent: Service[]
  categories: Category[]
  locale: string
  view: 'list' | 'table'
  actions: TileActions
}

// The Favorites tab: the "frequently used" strip on top, then the user's
// favorited services grouped by category (docs/01 §4.4, §4.5). Favorites are a
// flat set — no named lists.
export function FavoritesPanel({ favorites, frequent, categories, locale, view, actions }: FavoritesPanelProps) {
  const grid = view === 'table' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3'

  return (
    <div className="space-y-10">
      {frequent.length > 0 && (
        <section aria-labelledby="frequent">
          <h2 id="frequent" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            <span aria-hidden="true" className="inline-block h-4 w-1 rounded bg-primary" />
            Häufig genutzt
          </h2>
          <div className={grid}>
            {frequent.map((s) => (
              <Tile
                key={`freq-${s.id}`}
                service={s}
                categories={categories}
                locale={locale}
                favorited={actions.favoritedIDs.has(s.id)}
                onToggleFavorite={actions.onToggleFavorite}
                onLaunch={actions.onLaunch}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="my-favorites">
        <h1 id="my-favorites" className="mb-4 flex items-center gap-2 text-2xl font-bold">
          <span aria-hidden="true" className="inline-block h-7 w-1.5 rounded bg-primary" />
          Favoriten
        </h1>
        {favorites.length === 0 ? (
          <p className="text-sm text-text-muted">Noch nichts gemerkt. Tippe ☆ auf einem Dienst, um ihn hier abzulegen.</p>
        ) : (
          <CatalogView services={favorites} categories={categories} locale={locale} view={view} actions={actions} />
        )}
      </section>
    </div>
  )
}
