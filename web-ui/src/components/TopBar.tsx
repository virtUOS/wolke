import { LayoutGrid, LogOut, Moon, Rows3, Search, Sun } from 'lucide-react'
import type { Branding } from '@/lib/branding'
import type { Me } from '@/lib/api'
import { IconButton } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
import { SettingsMenu } from './SettingsMenu'

export type Tab = 'services' | 'favorites'

interface TopBarProps {
  branding: Branding
  showTabs: boolean
  tab: Tab
  onTab: (t: Tab) => void
  query: string
  onQuery: (q: string) => void
  view: 'list' | 'table'
  onToggleView: () => void
  isDark: boolean
  onToggleTheme: () => void
  userName: string
  onLogout: () => void
  favoritesOrder: Me['favorites_order']
  favoritesSeparateTab: boolean
  onChangeOrder: (order: Me['favorites_order']) => void
  onChangeSeparateTab: (on: boolean) => void
  isAdmin: boolean
  adminActive: boolean
  onToggleAdmin: () => void
}

// The persistent top bar (docs/01 §4.1, docs/03 §6): logo, the two primary tabs
// with a visible active highlight, search, and the theme + view toggles.
export function TopBar({
  branding,
  showTabs,
  tab,
  onTab,
  query,
  onQuery,
  view,
  onToggleView,
  isDark,
  onToggleTheme,
  userName,
  onLogout,
  favoritesOrder,
  favoritesSeparateTab,
  onChangeOrder,
  onChangeSeparateTab,
  isAdmin,
  adminActive,
  onToggleAdmin,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-surface bg-bg">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <picture className="shrink-0">
          <source srcSet={branding.logo_dark} media="(prefers-color-scheme: dark)" />
          <img src={branding.logo_light} alt={branding.product_name} className="h-7" />
        </picture>

        {showTabs && (
          <nav aria-label="Hauptnavigation" className="ml-2 flex items-center gap-1">
            <TabButton active={tab === 'favorites'} onClick={() => onTab('favorites')}>
              Favoriten
            </TabButton>
            <TabButton active={tab === 'services'} onClick={() => onTab('services')}>
              Dienste
            </TabButton>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <PillButton active={adminActive} aria-current={adminActive ? 'page' : undefined} onClick={onToggleAdmin}>
              Admin
            </PillButton>
          )}
          <label className="relative hidden sm:block">
            <span className="sr-only">Dienste durchsuchen</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Suchen…"
              className="h-9 w-48 rounded-md border border-surface bg-surface pl-8 pr-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] lg:w-64"
            />
          </label>

          <IconButton
            onClick={onToggleView}
            aria-label={view === 'table' ? 'Zur Listenansicht wechseln' : 'Zur Tabellenansicht wechseln'}
            title={view === 'table' ? 'Zur Listenansicht wechseln' : 'Zur Tabellenansicht wechseln'}
          >
            {view === 'table' ? <Rows3 className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
          </IconButton>

          <IconButton
            onClick={onToggleTheme}
            aria-label={isDark ? 'Helles Design' : 'Dunkles Design'}
            title={isDark ? 'Helles Design' : 'Dunkles Design'}
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </IconButton>

          <SettingsMenu
            order={favoritesOrder}
            separateTab={favoritesSeparateTab}
            onChangeOrder={onChangeOrder}
            onChangeSeparateTab={onChangeSeparateTab}
          />

          <span className="ml-1 hidden max-w-[12ch] truncate text-sm text-text-muted md:inline" title={userName}>
            {userName}
          </span>
          <IconButton onClick={onLogout} aria-label="Abmelden" title="Abmelden">
            <LogOut className="h-5 w-5" />
          </IconButton>
        </div>
      </div>

      {/* Mobile search row. */}
      <div className="px-4 pb-2 sm:hidden">
        <label className="relative block">
          <span className="sr-only">Dienste durchsuchen</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Suchen…"
            className="h-9 w-full rounded-md border border-surface bg-surface pl-8 pr-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          />
        </label>
      </div>
    </header>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <PillButton active={active} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {children}
    </PillButton>
  )
}
