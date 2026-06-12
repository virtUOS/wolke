import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import { api, type Category, type Me, type Service } from '@/lib/api'
import {
  useApplyTheme,
  useCatalog,
  useFavoriteActions,
  useFavorites,
  usePrefsMutation,
  useSearch,
} from '@/lib/hooks'
import { CatalogView } from './CatalogView'
import { FavoritesSection } from './FavoritesPanel'
import { type TileActions } from './Tile'
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
  const search = useSearch(query)
  const favorites = useFavorites()
  const fav = useFavoriteActions()
  const searching = query.trim().length > 0
  const separateTab = me.favorites_separate_tab

  const favoriteServices = useMemo(() => favorites.data?.services ?? [], [favorites.data])
  const favoritedIDs = useMemo(() => new Set(favoriteServices.map((s) => s.id)), [favoriteServices])

  const actions: TileActions = {
    favoritedIDs,
    onToggleFavorite: (s) => (favoritedIDs.has(s.id) ? fav.remove.mutate(s.id) : fav.add.mutate(s.id)),
    onLaunch: (s) => {
      api.recordClick(s.id)
      // Usage-ordered favorites should reflect the new click on next read.
      qc.invalidateQueries({ queryKey: ['favorites'] })
    },
  }

  const categories = catalog.data?.categories ?? []
  const favSection = (as: 'h1' | 'h2') => (
    <FavoritesSection favorites={favoriteServices} categories={categories} locale={locale} view={view} actions={actions} as={as} />
  )
  const catalogSection = catalog.isLoading || !catalog.data ? (
    <p className="text-sm text-text-muted" aria-busy="true">Lädt…</p>
  ) : (
    <CatalogView services={catalog.data.services} categories={categories} locale={locale} view={view} actions={actions} />
  )

  return (
    <div className="min-h-screen bg-bg text-text">
      <TopBar
        branding={branding}
        showTabs={separateTab}
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
        favoritesOrder={me.favorites_order}
        favoritesSeparateTab={separateTab}
        onChangeOrder={(order) => prefs.mutate({ favorites_order: order })}
        onChangeSeparateTab={(on) => prefs.mutate({ favorites_separate_tab: on })}
      />

      <main className="mx-auto max-w-6xl px-4 py-6">
        {searching ? (
          <SearchPanel
            query={query}
            isLoading={search.isLoading}
            results={search.data?.services ?? []}
            categories={categories}
            locale={locale}
            view={view}
            actions={actions}
          />
        ) : separateTab ? (
          // Tab layout: favorites get their own tab.
          tab === 'favorites' ? favSection('h1') : catalogSection
        ) : (
          // Default single page: favorites on top, then the category catalog.
          <div className="space-y-10">
            {favSection('h1')}
            {catalogSection}
          </div>
        )}
      </main>
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
