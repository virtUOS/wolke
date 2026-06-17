import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import { api, localized, type Category, type Me, type Service } from '@/lib/api'
import {
  useApplyTheme,
  useCatalog,
  useFavoriteActions,
  useFavorites,
  usePrefsMutation,
} from '@/lib/hooks'
import { useAnnouncements } from '@/lib/admin-hooks'
import { AdminView } from './admin/AdminView'
import { AnnouncementBanner } from './AnnouncementBanner'
import { CatalogView } from './CatalogView'
import { Tile, type TileActions } from './Tile'
import { TopBar, type Tab } from './TopBar'
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

function getTimeGreeting(): string {
  const h = new Date().getHours()
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}

function formatDate(): string {
  try {
    return new Date().toLocaleDateString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return ''
  }
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function filterServices(services: Service[], cats: string[], query: string): Service[] {
  const q = query.trim().toLowerCase()
  return services.filter((s) => {
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
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('favoriten')
  const [query, setQuery] = useState('')
  const [cats, setCats] = useState<string[]>([]) // [] = Alle; slugs
  const [adminOpen, setAdminOpen] = useState(false)
  const isMobile = useIsMobile()
  const layout = isMobile ? 'list' : 'grid'

  const isDark =
    me.theme === 'dark' || (me.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  useApplyTheme(me.theme)
  const prefs = usePrefsMutation()
  const announcements = useAnnouncements()
  const catalog = useCatalog()
  const favorites = useFavorites()
  const fav = useFavoriteActions()

  const allServices: Service[] = catalog.data?.services ?? []
  const allCategories: Category[] = catalog.data?.categories ?? []
  const favoriteServices: Service[] = favorites.data?.services ?? []
  const favoritedIDs = useMemo(() => new Set(favoriteServices.map((s) => s.id)), [favoriteServices])

  const actions: TileActions = {
    favoritedIDs,
    onToggleFavorite: (s) => (favoritedIDs.has(s.id) ? fav.remove.mutate(s.id) : fav.add.mutate(s.id)),
    onLaunch: (s) => {
      api.recordClick(s.id)
      qc.invalidateQueries({ queryKey: ['favorites'] })
    },
  }

  const toggleCat = (slug: string) => {
    if (slug === '') { setCats([]); return }
    setCats((prev) => (prev.includes(slug) ? prev.filter((c) => c !== slug) : [...prev, slug]))
  }

  const diensteServices = filterServices(allServices, cats, query)
  const filteredFavorites = useMemo(
    () => filterServices(favoriteServices, [], query),
    [favoriteServices, query],
  )

  const favCount = favoriteServices.length
  const firstName = me.display_name.split(' ')[0]

  const canvasStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: isDark
      ? 'color-mix(in srgb, var(--accent) 7%, var(--bg))'
      : 'color-mix(in srgb, var(--accent) 5%, var(--bg))',
    color: 'var(--text)',
  }

  if (adminOpen && me.is_admin) {
    return (
      <div style={canvasStyle}>
        <TopBar
          branding={branding}
          tab={tab}
          onTab={setTab}
          isDark={isDark}
          onToggleTheme={() => prefs.mutate({ theme: isDark ? 'light' : 'dark' })}
          userInitials={initials(me.display_name)}
          userName={me.display_name}
          userEmail={me.email}
          isAdmin={me.is_admin}
          onAdmin={() => setAdminOpen(true)}
          onLogout={() => void fetch('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/'))}
        />
        <main
          style={{
            maxWidth: 1180, margin: '0 auto',
            padding: isMobile ? '20px 16px 32px' : '28px 24px 40px',
          }}
        >
          <AdminView locale={locale} onExit={() => setAdminOpen(false)} />
        </main>
      </div>
    )
  }

  return (
    <div style={canvasStyle}>
      <TopBar
        branding={branding}
        tab={tab}
        onTab={setTab}
        isDark={isDark}
        onToggleTheme={() => prefs.mutate({ theme: isDark ? 'light' : 'dark' })}
        userInitials={initials(me.display_name)}
        userName={me.display_name}
        userEmail={me.email}
        isAdmin={me.is_admin}
        onAdmin={() => setAdminOpen(true)}
        onLogout={() => void fetch('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/'))}
      />

      <main
        style={{
          maxWidth: 1180, margin: '0 auto',
          padding: isMobile ? '20px 16px 32px' : '28px 24px 40px',
        }}
      >
        {/* ── Editorial greeting ────────────────────────────────────────── */}
        <header style={{ marginBottom: isMobile ? 18 : 28 }}>
          <div
            style={{
              fontFamily: '"Newsreader", Georgia, serif',
              fontWeight: 500,
              fontSize: isMobile ? 27 : 36,
              letterSpacing: '-0.015em',
              color: 'var(--text)',
              lineHeight: 1.05,
            }}
          >
            {getTimeGreeting()}, {firstName}.
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11.5, fontWeight: 600, letterSpacing: '.12em',
                textTransform: 'uppercase', color: 'var(--text-muted)',
              }}
            >
              {formatDate()}
            </span>
            {favCount > 0 && (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    width: 4, height: 4, borderRadius: 999,
                    background: 'var(--text-muted)', opacity: 0.5, flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {favCount} {favCount === 1 ? 'Favorit' : 'Favoriten'}
                </span>
              </>
            )}
          </div>
        </header>

        {/* ── Announcements (inside max-width column, between greeting and content) ── */}
        {(announcements.data?.announcements ?? []).length > 0 && (
          <div style={{ marginBottom: isMobile ? 18 : 24 }}>
            <AnnouncementBanner announcements={announcements.data!.announcements} locale={locale} />
          </div>
        )}

        {/* ── Section head: heading + search ───────────────────────────── */}
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
            {tab === 'favoriten' ? 'Favoriten' : cats.length === 0 ? 'Alle Dienste' : cats.length === 1
              ? (allCategories.find((c) => c.slug === cats[0]) ? localized(allCategories.find((c) => c.slug === cats[0])!.label, locale) : cats[0])
              : `${cats.length} Kategorien`}
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Dienste durchsuchen…"
            aria-label="Dienste suchen"
            style={{ width: isMobile ? '100%' : 260 }}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          />
        </div>

        {/* ── Category chips (Dienste tab only) ────────────────────────── */}
        {tab === 'dienste' && allCategories.length > 0 && (
          <div
            role="group"
            aria-label="Kategorien filtern"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: isMobile ? 16 : 20 }}
          >
            <PillButton
              active={cats.length === 0}
              aria-pressed={cats.length === 0}
              onClick={() => toggleCat('')}
            >
              Alle
            </PillButton>
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

        {/* ── Tab content ───────────────────────────────────────────────── */}
        {tab === 'favoriten' ? (
          filteredFavorites.length === 0 ? (
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
              {query
                ? `Keine Dienste für „${query}" gefunden.`
                : 'Noch keine Favoriten — markiere Dienste mit dem Stern.'}
            </div>
          ) : layout === 'list' ? (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {filteredFavorites.map((s) => (
                <Tile
                  key={s.id}
                  service={s}
                  categories={allCategories}
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
              {filteredFavorites.map((s) => (
                <Tile
                  key={s.id}
                  service={s}
                  categories={allCategories}
                  locale={locale}
                  layout="grid"
                  favorited={actions.favoritedIDs.has(s.id)}
                  onToggleFavorite={actions.onToggleFavorite}
                  onLaunch={actions.onLaunch}
                />
              ))}
            </div>
          )
        ) : catalog.isLoading ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }} aria-busy="true">Lädt…</p>
        ) : (
          <CatalogView
            services={diensteServices}
            categories={allCategories}
            locale={locale}
            layout={layout}
            actions={actions}
          />
        )}
      </main>
    </div>
  )
}
