import type { Category, Service } from '@/lib/api'
import { Tile, type TileActions } from './Tile'

interface FavoritesSectionProps {
  favorites: Service[]
  categories: Category[]
  locale: string
  layout: 'grid' | 'list'
  actions: TileActions
  /** Heading element to use — h1 when it leads the page, h2 inside a tab. */
  as?: 'h1' | 'h2'
}

export function FavoritesSection({ favorites, categories, locale, layout, actions, as = 'h1' }: FavoritesSectionProps) {
  const Heading = as

  return (
    <section aria-labelledby="favorites-heading">
      <Heading
        id="favorites-heading"
        style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}
      >
        Deine Favoriten
      </Heading>
      {favorites.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
          Noch nichts gemerkt. Tippe ☆ auf einem Dienst, um ihn hier abzulegen.
        </p>
      ) : layout === 'list' ? (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {favorites.map((s) => (
            <Tile
              key={s.id}
              service={s}
              categories={categories}
              locale={locale}
              layout="list"
              favorited={actions.favoritedIDs.has(s.id)}
              onToggleFavorite={actions.onToggleFavorite}
              onLaunch={actions.onLaunch}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(264px, 1fr))',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          {favorites.map((s) => (
            <Tile
              key={s.id}
              service={s}
              categories={categories}
              locale={locale}
              layout="grid"
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
