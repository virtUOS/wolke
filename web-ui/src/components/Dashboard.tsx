import { useEffect, useState } from 'react'
import type { Branding } from '@/lib/branding'
import type { Catalog, Category, Me, Service } from '@/lib/api'
import { useApplyTheme, useCatalog, useDefaults, usePrefsMutation, useSearch } from '@/lib/hooks'
import { CatalogView } from './CatalogView'
import { Tile } from './Tile'
import { TopBar, type Tab } from './TopBar'

// useEffectiveView resolves 'auto' to table on wide viewports, list otherwise
// (mobile-first: list is the phone default — docs/03 §4).
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
  const searching = query.trim().length > 0

  const toggleTheme = () => prefs.mutate({ theme: isDark ? 'light' : 'dark' })
  const toggleView = () => prefs.mutate({ view_mode: view === 'table' ? 'list' : 'table' })

  return (
    <div className="min-h-screen bg-bg text-text">
      <TopBar
        branding={branding}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        view={view}
        onToggleView={toggleView}
        isDark={isDark}
        onToggleTheme={toggleTheme}
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
          />
        ) : tab === 'favorites' ? (
          <EmptyFavorites />
        ) : (
          <ServicesPanel
            locale={locale}
            view={view}
            displayName={me.display_name}
            defaultsLoading={defaults.isLoading}
            defaultServices={defaults.data?.services ?? []}
            catalogLoading={catalog.isLoading}
            catalog={catalog.data}
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
}: {
  locale: string
  view: 'list' | 'table'
  displayName: string
  defaultsLoading: boolean
  defaultServices: Service[]
  catalogLoading: boolean
  catalog: Catalog | undefined
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
              <Tile key={s.id} service={s} categories={catalog.categories} locale={locale} />
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
          <CatalogView services={catalog.services} categories={catalog.categories} locale={locale} view={view} />
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
}: {
  query: string
  isLoading: boolean
  results: Service[]
  categories: Category[]
  locale: string
  view: 'list' | 'table'
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
        <CatalogView services={results} categories={categories} locale={locale} view={view} />
      )}
    </section>
  )
}

function EmptyFavorites() {
  return (
    <div className="rounded-lg border border-dashed border-surface p-10 text-center text-sm text-text-muted">
      Favoriten kommen in Kürze. Bald kannst du Dienste mit ☆ hier ablegen.
    </div>
  )
}
