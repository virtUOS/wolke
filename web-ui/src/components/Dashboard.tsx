import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import { api, type Catalog, type Category, type Me, type Service } from '@/lib/api'
import {
  useApplyTheme,
  useCatalog,
  useDefaults,
  useFavoriteActions,
  useFavorites,
  useFrequent,
  usePrefsMutation,
  useSearch,
} from '@/lib/hooks'
import { CatalogView } from './CatalogView'
import { FavoritesPanel } from './FavoritesPanel'
import { Tile, type TileActions } from './Tile'
import { TopBar, type Tab } from './TopBar'

function useEffectiveView(mode: Me['view_mode']): 'list' | 'table' {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    const on = () => setWide(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  if (mode === 'list' || mode === 'table') return mode
  return wide ? 'table' : 'list'
}

function gridClass(view: 'list' | 'table'): string {
  return view === 'table' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3'
}

export function Dashboard({ branding, me }: { branding: Branding; me: Me }) {
  const locale = branding.default_locale || 'de'
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('services')
  const [query, setQuery] = useState('')

  useApplyTheme(me.theme)
  const prefs = usePrefsMutation()
  const view = useEffectiveView(me.view_mode)
  const isDark =
    me.theme === 'dark' || (me.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const catalog = useCatalog()
  const defaults = useDefaults()
  const search = useSearch(query)
  const favorites = useFavorites()
  const frequent = useFrequent()
  const fav = useFavoriteActions()
  const searching = query.trim().length > 0

  const favoriteServices = useMemo(() => favorites.data?.services ?? [], [favorites.data])
  const favoritedIDs = useMemo(() => new Set(favoriteServices.map((s) => s.id)), [favoriteServices])

  const actions: TileActions = {
    favoritedIDs,
    onToggleFavorite: (s) => {
      if (favoritedIDs.has(s.id)) {
        fav.remove.mutate(s.id)
      } else {
        fav.add.mutate(s.id)
      }
    },
    onLaunch: (s) => {
      api.recordClick(s.id)
      qc.invalidateQueries({ queryKey: ['frequent'] })
    },
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <TopBar
        branding={branding}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        view={view}
        onToggleView={() => prefs.mutate({ view_mode: view === 'table' ? 'list' : 'table' })}
        isDark={isDark}
        onToggleTheme={() => prefs.mutate({ theme: isDark ? 'light' : 'dark' })}
        userName={me.display_name}
        onLogout={() => {
          void fetch('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/'))
        }}
      />

      <main className="mx-auto max-w-6xl px-4 py-6">
        {searching ? (
          <SearchPanel
            query={query}
            isLoading={search.isLoading}
            results={search.data?.services ?? []}
            categories={catalog.data?.categories ?? []}
            locale={locale}
            view={view}
            actions={actions}
          />
        ) : tab === 'favorites' ? (
          <FavoritesPanel
            favorites={favoriteServices}
            frequent={frequent.data?.services ?? []}
            categories={catalog.data?.categories ?? []}
            locale={locale}
            view={view}
            actions={actions}
          />
        ) : (
          <ServicesPanel
            locale={locale}
            view={view}
            displayName={me.display_name}
            defaultsLoading={defaults.isLoading}
            defaultServices={defaults.data?.services ?? []}
            catalogLoading={catalog.isLoading}
            catalog={catalog.data}
            actions={actions}
          />
        )}
      </main>
    </div>
  )
}

function ServicesPanel({
  locale,
  view,
  displayName,
  defaultsLoading,
  defaultServices,
  catalogLoading,
  catalog,
  actions,
}: {
  locale: string
  view: 'list' | 'table'
  displayName: string
  defaultsLoading: boolean
  defaultServices: Service[]
  catalogLoading: boolean
  catalog: Catalog | undefined
  actions: TileActions
}) {
  return (
    <div className="space-y-10">
      <section aria-labelledby="for-you">
        <h1 id="for-you" className="mb-4 flex items-center gap-2 text-2xl font-bold">
          <span aria-hidden="true" className="inline-block h-7 w-1.5 rounded bg-primary" />
          Für dich, {displayName}
        </h1>
        {defaultsLoading ? (
          <p className="text-sm text-text-muted" aria-busy="true">
            Lädt…
          </p>
        ) : defaultServices.length > 0 && catalog ? (
          <div className={gridClass(view)}>
            {defaultServices.map((s) => (
              <Tile
                key={s.id}
                service={s}
                categories={catalog.categories}
                locale={locale}
                favorited={actions.favoritedIDs.has(s.id)}
                onToggleFavorite={actions.onToggleFavorite}
                onLaunch={actions.onLaunch}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">Noch keine Vorauswahl für deine Rolle.</p>
        )}
      </section>

      <section aria-labelledby="all-services">
        <h2 id="all-services" className="mb-4 text-lg font-semibold text-text-muted">
          Alle Dienste
        </h2>
        {catalogLoading || !catalog ? (
          <p className="text-sm text-text-muted" aria-busy="true">
            Lädt…
          </p>
        ) : (
          <CatalogView services={catalog.services} categories={catalog.categories} locale={locale} view={view} actions={actions} />
        )}
      </section>
    </div>
  )
}

function SearchPanel({
  query,
  isLoading,
  results,
  categories,
  locale,
  view,
  actions,
}: {
  query: string
  isLoading: boolean
  results: Service[]
  categories: Category[]
  locale: string
  view: 'list' | 'table'
  actions: TileActions
}) {
  return (
    <section aria-labelledby="search-results" aria-live="polite">
      <h1 id="search-results" className="mb-4 text-lg font-semibold">
        Ergebnisse für „{query}“
      </h1>
      {isLoading ? (
        <p className="text-sm text-text-muted" aria-busy="true">
          Sucht…
        </p>
      ) : results.length === 0 ? (
        <p className="text-sm text-text-muted">Keine Treffer. Versuch einen anderen Begriff.</p>
      ) : (
        <CatalogView services={results} categories={categories} locale={locale} view={view} actions={actions} />
      )}
    </section>
  )
}
