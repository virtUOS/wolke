import { useEffect, useMemo, useState } from 'react'
import { Wrench } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import { api, localized, type Category, type Me, type Service } from '@/lib/api'
import { t, effectiveLocale } from '@/lib/i18n'
import { applyFilter, filterEq, searchAll, type Filter } from '@/lib/catalog-filter'
import {
  useApplyTheme,
  useCatalog,
  useFavoriteActions,
  useFavorites,
  usePrefersDark,
  usePrefsMutation,
} from '@/lib/hooks'
import { useAnnouncements } from '@/lib/admin-hooks'
import { AdminView } from './admin/AdminView'
import { AnnouncementBanner } from './AnnouncementBanner'
import { CatalogView } from './CatalogView'
import { DashboardShell } from './DashboardShell'
import { Greeting } from './Greeting'
import { type TileActions } from './Tile'
import { type Tab } from './TopBar'
import { PillButton } from '@/components/ui/pill-button'

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => !window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    const on = () => setMobile(!mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return mobile
}

// Stable empty fallbacks so `?? EMPTY` keeps a constant reference while queries
// load — otherwise the derived arrays change identity every render and defeat
// the useMemo deps below.
const NO_SERVICES: Service[] = []
const NO_CATEGORIES: Category[] = []

export function Dashboard({ branding, me }: { branding: Branding; me: Me }) {
  // Effective locale: an explicit user pref ('de'/'en') wins; 'auto' defers to
  // the browser and then branding.default_locale. Resolved once here and threaded
  // down so every view (and the chrome) renders in one language.
  const locale = effectiveLocale(me.locale, branding.default_locale)
  const tr = t(locale)
  // Keep <html lang> authoritative once the user (and their pref) is known.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('favoriten')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' }) // single active facet
  const [adminOpen, setAdminOpen] = useState(false)
  const searching = query.trim() !== ''
  const isMobile = useIsMobile()
  const layout = isMobile ? 'list' : 'grid'

  const prefersDark = usePrefersDark()
  const isDark = me.theme === 'dark' || (me.theme === 'system' && prefersDark)

  useApplyTheme(me.theme)
  const prefs = usePrefsMutation()
  const announcements = useAnnouncements()
  const catalog = useCatalog()
  const favorites = useFavorites()
  const fav = useFavoriteActions()

  const allServices: Service[] = catalog.data?.services ?? NO_SERVICES
  const allCategories: Category[] = catalog.data?.categories ?? NO_CATEGORIES
  const favoriteServices: Service[] = favorites.data?.services ?? NO_SERVICES
  const favoritedIDs = useMemo(() => new Set(favoriteServices.map((s) => s.id)), [favoriteServices])

  const actions: TileActions = {
    favoritedIDs,
    onToggleFavorite: (s) => (favoritedIDs.has(s.id) ? fav.remove.mutate(s.id) : fav.add.mutate(s.id)),
    onLaunch: (s, target) => {
      api.recordClick(s.id, target)
      qc.invalidateQueries({ queryKey: ['favorites'] })
    },
  }

  // Filters are single-select: picking a facet replaces the active one, and
  // clicking the active facet again returns to "Alle".
  const selectFilter = (next: Filter) => setFilter((prev) => (filterEq(prev, next) ? { kind: 'all' } : next))

  // Search is global: when a query is present it matches across ALL services,
  // independent of the active tab, and any active filter is deactivated.
  const onSearch = (value: string) => {
    setQuery(value)
    if (value.trim() && filter.kind !== 'all') setFilter({ kind: 'all' })
  }

  // Jump to the favorites tab (shortcut from the greeting's favorites count).
  const showFavorites = () => {
    setTab('favoriten')
    setQuery('')
  }

  // Jump to the Dienste tab showing only services currently in maintenance.
  const showMaintenance = () => {
    setTab('dienste')
    setQuery('')
    setFilter({ kind: 'maintenance' })
  }

  // Result set: a search overrides everything (global, no tab/filter); otherwise
  // favorites are shown as-is and the Dienste tab applies the active facet.
  const results = useMemo(() => {
    if (searching) return searchAll(allServices, query)
    if (tab === 'favoriten') return favoriteServices
    return applyFilter(allServices, filter)
  }, [searching, query, tab, allServices, favoriteServices, filter])

  const maintenanceCount = useMemo(
    () => allServices.filter((s) => s.tag === 'wartung').length,
    [allServices],
  )

  // Section heading for the current view.
  const heading = useMemo(() => {
    if (searching) return tr.dash.searchResults
    if (tab === 'favoriten') return tr.dash.favorites
    if (filter.kind === 'maintenance') return tr.dash.inMaintenance
    if (filter.kind === 'category') {
      const c = allCategories.find((x) => x.slug === filter.slug)
      return c ? localized(c.label, locale) : filter.slug
    }
    return tr.dash.allServices
  }, [searching, tab, filter, allCategories, locale, tr])

  const favCount = favoriteServices.length
  const firstName = me.display_name.split(' ')[0]

  const shellProps = {
    branding,
    me,
    locale,
    tab,
    // Switching tab always returns to the dashboard, even from the admin view.
    onTab: (next: Tab) => { setAdminOpen(false); setTab(next) },
    isDark,
    onToggleTheme: () => prefs.mutate({ theme: isDark ? 'light' : 'dark' }),
    onSetLocale: (next: Me['locale']) => prefs.mutate({ locale: next }),
    onAdmin: () => setAdminOpen(true),
    isMobile,
    focusKey: adminOpen ? 'admin' : 'dashboard',
  }

  if (adminOpen && me.is_admin) {
    return (
      <DashboardShell {...shellProps}>
        <AdminView locale={locale} onExit={() => setAdminOpen(false)} />
      </DashboardShell>
    )
  }

  return (
    <DashboardShell {...shellProps}>
      <Greeting
        firstName={firstName}
        locale={locale}
        isMobile={isMobile}
        favCount={favCount}
        maintenanceCount={maintenanceCount}
        onShowFavorites={showFavorites}
        onShowMaintenance={showMaintenance}
      />

      {/* Announcements (inside max-width column, between greeting and content) */}
      {(announcements.data?.announcements ?? []).length > 0 && (
        <div style={{ marginBottom: isMobile ? 18 : 24 }}>
          <AnnouncementBanner announcements={announcements.data!.announcements} locale={locale} />
        </div>
      )}

      {/* Section head. Mobile is intentionally minimal — just the search box on
          the Dienste tab (no heading, no category chips); discovery relies on
          search. Desktop keeps the heading + search and the category filters. */}
      {isMobile ? (
        tab === 'dienste' && (
          <div style={{ marginBottom: 16 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={tr.dash.searchPlaceholder}
              aria-label={tr.dash.searchLabel}
              style={{ width: '100%' }}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            />
          </div>
        )
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            marginBottom: 18,
          }}
        >
          <h2
            style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', flexShrink: 0 }}
          >
            {heading}
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={tr.dash.searchPlaceholder}
            aria-label={tr.dash.searchLabel}
            style={{ width: 260 }}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          />
        </div>
      )}

      {/* Single-select filters: desktop only (mobile relies on search). Hidden
          while searching, since a search is global and deactivates filters.
          "In Wartung" is always shown so maintenance is reachable as a facet. */}
      {!isMobile && tab === 'dienste' && !searching && (
        <div
          role="group"
          aria-label={tr.dash.filterCategories}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: isMobile ? 16 : 20 }}
        >
          <PillButton
            active={filter.kind === 'all'}
            aria-pressed={filter.kind === 'all'}
            onClick={() => selectFilter({ kind: 'all' })}
          >
            {tr.dash.all}
          </PillButton>
          <PillButton
            active={filter.kind === 'maintenance'}
            aria-pressed={filter.kind === 'maintenance'}
            onClick={() => selectFilter({ kind: 'maintenance' })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Wrench className="h-[13px] w-[13px]" aria-hidden="true" />
            {tr.dash.inMaintenance}
          </PillButton>
          {allCategories.map((c) => (
            <PillButton
              key={c.slug}
              active={filter.kind === 'category' && filter.slug === c.slug}
              aria-pressed={filter.kind === 'category' && filter.slug === c.slug}
              onClick={() => selectFilter({ kind: 'category', slug: c.slug })}
            >
              {localized(c.label, locale)}
            </PillButton>
          ))}
        </div>
      )}

      {/* Polite live region: announces the result count to screen-reader users
          when a search/filter/tab change alters what's shown (it stays silent on
          first render). */}
      <div aria-live="polite" className="sr-only">
        {tr.dash.resultCount(results.length)}
      </div>

      {/* Content: a search shows global results; otherwise the active tab/filter.
          Favorites render their own list; everything else needs the catalog. */}
      {!searching && tab === 'favoriten' ? (
        <CatalogView
          services={results}
          categories={allCategories}
          locale={locale}
          layout={layout}
          actions={actions}
          emptyMessage={tr.dash.favEmpty}
        />
      ) : catalog.isLoading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }} role="status" aria-busy="true">{tr.common.loading}</p>
      ) : (
        <CatalogView
          services={results}
          categories={allCategories}
          locale={locale}
          layout={layout}
          actions={actions}
          emptyMessage={searching ? tr.dash.searchEmpty(query) : undefined}
        />
      )}
    </DashboardShell>
  )
}
