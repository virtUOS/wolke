import type { Category, Service } from '@/lib/api'
import { Tile, type TileActions } from './Tile'

interface CatalogViewProps {
  services: Service[]
  categories: Category[]
  locale: string
  layout: 'grid' | 'list'
  actions?: TileActions
  /** Shown when there are no services (e.g. the favorites tab's own copy). */
  emptyMessage?: string
}

// Flat service grid (Editorial direction). Category grouping was removed —
// filtering is done upstream via the category chips in Dashboard.
export function CatalogView({ services, categories, locale, layout, actions, emptyMessage }: CatalogViewProps) {
  if (services.length === 0) {
    return (
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
        {emptyMessage ?? 'Keine Dienste gefunden.'}
      </div>
    )
  }

  if (layout === 'list') {
    return (
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {services.map((s) => (
          <Tile
            key={s.id}
            service={s}
            categories={categories}
            locale={locale}
            layout="list"
            favorited={actions?.favoritedIDs.has(s.id)}
            onToggleFavorite={actions?.onToggleFavorite}
            onLaunch={actions?.onLaunch}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(264px, 1fr))',
        gap: 16,
        alignItems: 'stretch',
      }}
    >
      {services.map((s) => (
        <Tile
          key={s.id}
          service={s}
          categories={categories}
          locale={locale}
          layout="grid"
          favorited={actions?.favoritedIDs.has(s.id)}
          onToggleFavorite={actions?.onToggleFavorite}
          onLaunch={actions?.onLaunch}
        />
      ))}
    </div>
  )
}
