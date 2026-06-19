import { useEffect, useMemo, useState } from 'react'
import { Wrench, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import { api, localized, type Category, type Me, type Service, type ServiceTag } from '@/lib/api'
import { t } from '@/lib/i18n'
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

function filterServices(services: Service[], cats: string[], query: string, tag: ServiceTag | null = null): Service[] {
  const q = query.trim().toLowerCase()
  return services.filter((s) => {
    if (tag && s.tag !== tag) return false
    if (cats.length > 0 && !s.categories.some((c) => cats.includes(c))) return false
    if (q && !(
      s.name.toLowerCase().includes(q) ||
      Object.values(s.description).some((d) => d.toLowerCase().includes(q))
    )) return false
    return true
  })
}

export function Dashboard({ branding, me }: { branding: Branding; me: Me }) {
  const locale = branding.default_locale || 'de'
  const tr = t(locale)
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('favoriten')
  const [query, setQuery] = useState('')
  const [cats, setCats] = useState<string[]>([]) // [] = Alle; slugs
  const [tagFilter, setTagFilter] = useState<ServiceTag | null>(null) // quick-filter by status tag
  const [adminOpen, setAdminOpen] = useState(false)
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

  // Category chips and the status-tag quick-filter are distinct filter axes;
  // selecting a category clears the tag filter so the result set stays legible.
  const toggleCat = (slug: string) => {
    setTagFilter(null)
    if (slug === '') { setCats([]); return }
    setCats((prev) => (prev.includes(slug) ? prev.filter((c) => c !== slug) : [...prev, slug]))
  }

  // Jump to the Dienste tab showing only services currently in maintenance.
  const showMaintenance = () => {
    setTab('dienste')
    setCats([])
    setQuery('')
    setTagFilter('wartung')
  }

  const diensteServices = useMemo(
    () => filterServices(allServices, cats, query, tagFilter),
    [allServices, cats, query, tagFilter],
  )
  const maintenanceCount = useMemo(
    () => allServices.filter((s) => s.tag === 'wartung').length,
    [allServices],
  )
  const filteredFavorites = useMemo(
    () => filterServices(favoriteServices, [], query),
    [favoriteServices, query],
  )

  // Section heading for the current tab/filter (find the category once).
  const heading = useMemo(() => {
    if (tab === 'favoriten') return tr.dash.favorites
    if (tagFilter === 'wartung') return tr.dash.inMaintenance
    if (cats.length === 0) return tr.dash.allServices
    if (cats.length === 1) {
      const c = allCategories.find((x) => x.slug === cats[0])
      return c ? localized(c.label, locale) : cats[0]
    }
    return tr.dash.categoriesCount(cats.length)
  }, [tab, tagFilter, cats, allCategories, locale, tr])

  const favCount = favoriteServices.length
  const firstName = me.display_name.split(' ')[0]

  const shellProps = {
    branding,
    me,
    tab,
    onTab: setTab,
    isDark,
    onToggleTheme: () => prefs.mutate({ theme: isDark ? 'light' : 'dark' }),
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
        onShowMaintenance={showMaintenance}
      />

      {/* Announcements (inside max-width column, between greeting and content) */}
      {(announcements.data?.announcements ?? []).length > 0 && (
        <div style={{ marginBottom: isMobile ? 18 : 24 }}>
          <AnnouncementBanner announcements={announcements.data!.announcements} locale={locale} />
        </div>
      )}

      {/* Section head: heading + search */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 12 : 20,
          marginBottom: isMobile ? 16 : 18,
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
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr.dash.searchPlaceholder}
          aria-label={tr.dash.searchLabel}
          style={{ width: isMobile ? '100%' : 260 }}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        />
      </div>

      {/* Category chips (Dienste tab only) */}
      {tab === 'dienste' && allCategories.length > 0 && (
        <div
          role="group"
          aria-label={tr.dash.filterCategories}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: isMobile ? 16 : 20 }}
        >
          <PillButton
            active={cats.length === 0 && !tagFilter}
            aria-pressed={cats.length === 0 && !tagFilter}
            onClick={() => toggleCat('')}
          >
            {tr.dash.all}
          </PillButton>
          {tagFilter === 'wartung' && (
            <PillButton
              active
              aria-pressed
              onClick={() => setTagFilter(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Wrench className="h-[13px] w-[13px]" aria-hidden="true" />
              {tr.dash.inMaintenance}
              <X className="h-[13px] w-[13px]" aria-hidden="true" />
            </PillButton>
          )}
          {allCategories.map((c) => (
            <PillButton
              key={c.slug}
              active={cats.includes(c.slug)}
              aria-pressed={cats.includes(c.slug)}
              onClick={() => toggleCat(c.slug)}
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
        {tr.dash.resultCount(tab === 'favoriten' ? filteredFavorites.length : diensteServices.length)}
      </div>

      {/* Tab content */}
      {tab === 'favoriten' ? (
        <CatalogView
          services={filteredFavorites}
          categories={allCategories}
          locale={locale}
          layout={layout}
          actions={actions}
          emptyMessage={query ? tr.dash.searchEmpty(query) : tr.dash.favEmpty}
        />
      ) : catalog.isLoading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }} role="status" aria-busy="true">{tr.common.loading}</p>
      ) : (
        <CatalogView
          services={diensteServices}
          categories={allCategories}
          locale={locale}
          layout={layout}
          actions={actions}
        />
      )}
    </DashboardShell>
  )
}
