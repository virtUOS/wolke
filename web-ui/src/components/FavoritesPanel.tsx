import type { Category, Service } from '@/lib/api'
import { Tile, type TileActions } from './Tile'

interface FavoritesSectionProps {
  favorites: Service[]
  categories: Category[]
  locale: string
  view: 'list' | 'table'
  actions: TileActions
  /** Heading element to use — h1 when it leads the page, h2 inside a tab. */
  as?: 'h1' | 'h2'
}

// "Deine Favoriten": the user's favorited services as a flat grid, already
// ordered server-side (by usage or alphabetically). No categories, no lists
// (concept §4.4).
export function FavoritesSection({ favorites, categories, locale, view, actions, as = 'h1' }: FavoritesSectionProps) {
  const grid = view === 'table' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3'
  const Heading = as
  const headingClass = as === 'h1' ? 'text-2xl font-bold' : 'text-lg font-semibold'

  return (
    <section aria-labelledby="favorites">
      <Heading id="favorites" className={`mb-4 flex items-center gap-2 ${headingClass}`}>
        <span aria-hidden="true" className="inline-block h-7 w-1.5 rounded bg-primary" />
        Deine Favoriten
      </Heading>
      {favorites.length === 0 ? (
        <p className="text-sm text-text-muted">Noch nichts gemerkt. Tippe ☆ auf einem Dienst, um ihn hier abzulegen.</p>
      ) : (
        <div className={grid}>
          {favorites.map((s) => (
            <Tile
              key={s.id}
              service={s}
              categories={categories}
              locale={locale}
              favorited={actions.favoritedIDs.has(s.id)}
              onToggleFavorite={actions.onToggleFavorite}
              onLaunch={actions.onLaunch}
            />
          ))}
        </div>
      )}
    </section>
  )
}
