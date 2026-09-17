import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FlaskConical, Wrench } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { assistantEnabled, type Branding } from '@/lib/branding'
import { DESKTOP_MEDIA_QUERY } from '@/lib/breakpoints'
import { api, localized, type Category, type Me, type Service } from '@/lib/api'
import { t, effectiveLocale } from '@/lib/i18n'
import { applyFilter, filterEq, type Filter } from '@/lib/catalog-filter'
import { useViewHistory } from '@/lib/view-history'
import {
  useApplyTheme,
  useCatalog,
  useDebouncedValue,
  useFavoriteActions,
  useFavorites,
  useFavoritesOrderMutation,
  usePrefersDark,
  usePrefsMutation,
  useResultAnnouncement,
  useSearch,
} from '@/lib/hooks'
import { useAnnouncements } from '@/lib/admin-hooks'
import { AdminView } from './admin/AdminView'
import { AnnouncementBanner } from './AnnouncementBanner'
import { AssistantWidget } from './AssistantWidget'
import { PwaInstallHint } from './PwaInstallHint'
import { CatalogView } from './CatalogView'
import { DashboardShell } from './DashboardShell'
import { FavoritesArrange, FavoritesSortMenu } from './FavoritesOrder'
import { Greeting } from './Greeting'
import { LauncherTabs } from './LauncherTabs'
import { SearchResults } from './SearchResults'
import { GlobalSearch, useSearchHotkeys } from './GlobalSearch'
import { type TileActions } from './Tile'
import { type Tab } from '@/lib/view-url'
import { PillButton } from '@/components/ui/pill-button'
import { RestrictedMarker } from '@/components/ui/restricted-marker'

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => !window.matchMedia(DESKTOP_MEDIA_QUERY).matches)
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY)
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
  const [query, setQuery] = useState('')
  // Phone only: whether the app-bar search field is revealed (issue #171).
  // A desktop has no such state — the field is simply always in the bar.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Standing down from search: drop the query AND put the phone's field away.
  // One function, because every caller means both — a tab switch, a popstate,
  // and the plain-click launch that leaves a stale query behind (issue #27).
  const clearSearch = useCallback(() => {
    setQuery('')
    setSearchOpen(false)
  }, [])
  // View state (tab, filter, admin) lives in the browser history so Back and
  // Forward walk through views and view URLs are deep-linkable (issue #29).
  // Search stays local and out of the URL; every navigation cancels it, and
  // popstate does the same via onPop.
  const { view, navigate, replace } = useViewHistory({ onPop: clearSearch })
  const { tab, filter } = view
  const searching = query.trim() !== ''
  const isMobile = useIsMobile()
  const layout = isMobile ? 'list' : 'grid'

  // `searchOpen` belongs to the phone layout alone, so it must not outlive a
  // crossing of the breakpoint (issue #198, docs/specs/search-view-state.md
  // §3): the desktop renders no overlay, so a flag left standing there is one
  // that pops the full-bar overlay open the next time the window narrows.
  // Adjusted during render — the pattern the view invariants below use, and the
  // reason this needs no effect and no second source of truth.
  const [lastMobile, setLastMobile] = useState(isMobile)
  if (lastMobile !== isMobile) {
    setLastMobile(isMobile)
    setSearchOpen(false)
  }
  // The phone overlay's real state: the flag, plus the rule that an active
  // query is always visible and clearable. The query itself crosses the
  // breakpoint untouched (losing typed text on a rotate is the worse failure),
  // and this is what makes that safe — a query typed in the desktop bar arrives
  // in the phone layout with a field to see it in and a ✕ to drop it with,
  // rather than narrowing the list from a control that isn't on screen.
  const phoneSearchOpen = isMobile && (searchOpen || searching)

  const prefersDark = usePrefersDark()
  const isDark = me.theme === 'dark' || (me.theme === 'system' && prefersDark)

  useApplyTheme(me.theme)
  const prefs = usePrefsMutation()
  const announcements = useAnnouncements()
  const catalog = useCatalog()
  const favorites = useFavorites()
  const fav = useFavoriteActions()
  const favOrder = useFavoritesOrderMutation()
  // The user asked for the arrange edit mode. Whether it is actually *open* is
  // derived below rather than corrected in an effect: it only exists in manual
  // mode and only with something to arrange, so leaving the mode (or
  // un-starring the last favorite) closes it without a second state to sync.
  const [arrangeRequested, setArrangeRequested] = useState(false)

  const allServices: Service[] = catalog.data?.services ?? NO_SERVICES
  // Facet counts over the *narrowed* catalog, so they are this reader's counts:
  // a tag facet is only offered when it selects something (issue #139,
  // docs/specs/empty-facets.md §3). They sit above the view invariants because
  // the stale-filter guards below need them.
  const maintenanceCount = useMemo(
    () => allServices.filter((s) => s.tag === 'wartung').length,
    [allServices],
  )
  const betaCount = useMemo(() => allServices.filter((s) => s.tag === 'beta').length, [allServices])
  const showMaintenanceFacet = maintenanceCount > 0
  const showBetaFacet = me.show_beta && betaCount > 0

  // View invariants, enforced during render (the repo's adjust-during-render
  // pattern — the lint rule forbids sync setState in effects). All corrections
  // use replace(): no history entries, and each guard fails on the corrected
  // view, so popstate into an invalid entry is fixed once and cannot loop.
  if (isMobile && filter.kind !== 'all') {
    // Mobile has no filter controls (pills + greeting shortcuts are desktop-
    // only); discovery is search-only, so a carried-over filter is unusable.
    replace({ ...view, filter: { kind: 'all' } })
  } else if (view.admin && !me.is_admin) {
    // ?admin=1 deep link (or a stale history entry) without permission.
    replace({ ...view, admin: false })
  } else if (
    filter.kind === 'category' &&
    catalog.data &&
    !catalog.data.categories.some((c) => c.slug === filter.slug)
  ) {
    // Unknown category slug in a deep link — validated once the catalog loads.
    replace({ ...view, filter: { kind: 'all' } })
  } else if (filter.kind === 'beta' && (!me.show_beta || (catalog.data && betaCount === 0))) {
    // The Beta facet outlived its pill: the user switched beta services off (or
    // deep-linked ?filter=beta without them), or nothing is tagged beta any
    // more. Leaving it would head the page "Beta" with no tiles and no active
    // pill — same correction, same reason as the stale category above (review
    // finding 3; the count half is issue #139).
    replace({ ...view, filter: { kind: 'all' } })
  } else if (filter.kind === 'maintenance' && catalog.data && maintenanceCount === 0) {
    // The same correction for the maintenance facet, whose pill is now gated on
    // its count too (issue #139) — a ?filter=maintenance link outlives the
    // outage that made it meaningful.
    replace({ ...view, filter: { kind: 'all' } })
  }

  // Search is server-side and debounced (the one search path; matching + ranking
  // live in the backend). Results stay visible while the next query loads.
  const debouncedQuery = useDebouncedValue(query, 150)
  const searchResults = useSearch(debouncedQuery)

  const allCategories: Category[] = catalog.data?.categories ?? NO_CATEGORIES
  const favoriteServices: Service[] = favorites.data?.services ?? NO_SERVICES
  const favoritedIDs = useMemo(() => new Set(favoriteServices.map((s) => s.id)), [favoriteServices])

  const actions: TileActions = {
    favoritedIDs,
    onToggleFavorite: (s) => (favoritedIDs.has(s.id) ? fav.remove.mutate(s.id) : fav.add.mutate(s.id)),
    // Tools open in a new tab (issue #26), so a stale search is what's left
    // behind when the user comes back. Clear it — but only for the launch a
    // user actually returns from: a plain left click on the service link
    // itself, not the doc link, and not a deliberate new-tab gesture
    // (Ctrl/Cmd/Shift/middle-click), which Tile already filters out via
    // `plainClick` (issue #27). Click tracking fires unconditionally.
    onLaunch: (s, target, plainClick) => {
      api.recordClick(s.id, target)
      qc.invalidateQueries({ queryKey: ['favorites'] })
      if (searching && target === undefined && plainClick) clearSearch()
    },
  }

  // Filters are single-select: picking a facet replaces the active one, and
  // clicking the active facet again returns to "Alle". Each pick is one
  // history entry.
  const selectFilter = (next: Filter) =>
    navigate({ tab: 'dienste', admin: false, filter: filterEq(filter, next) ? { kind: 'all' } : next })

  // Search is global: when a query is present it matches across ALL services,
  // independent of the active tab, and any active filter is deactivated.
  // Typing must never create history entries, so the filter clear replaces.
  const onSearch = (value: string) => {
    setQuery(value)
    if (!value.trim()) return
    if (filter.kind !== 'all') replace({ ...view, filter: { kind: 'all' } })
    // …and it cancels the Anordnen edit mode, for the same reason (issue #198,
    // docs/specs/search-view-state.md §2): a search resets the view, the way a
    // tab switch and a popstate already cancel a search. Cancelled, not
    // suppressed — clearing the query lands on the ordinary favorites list, and
    // the mode is re-entered the way it was entered, through the sort menu.
    setArrangeRequested(false)
  }

  // Jump to the Dienste tab showing only services currently in maintenance.
  const showMaintenance = () => {
    clearSearch()
    navigate({ tab: 'dienste', filter: { kind: 'maintenance' }, admin: false })
  }

  // Result set: a search overrides everything (global, no tab/filter); otherwise
  // favorites are shown as-is and the Dienste tab applies the active facet.
  const results = useMemo(() => {
    if (searching) return searchResults.data?.services ?? NO_SERVICES
    if (tab === 'favoriten') return favoriteServices
    return applyFilter(allServices, filter)
  }, [searching, searchResults.data, tab, allServices, favoriteServices, filter])

  // A failed /api/search shows an error (not a stuck spinner): search is now a
  // server round-trip, so unlike the old client-side filter it can fail.
  const searchFailed = searching && searchResults.isError
  // True only until the first results for the current search arrive; subsequent
  // keystrokes keep the previous list (placeholderData) so it doesn't flicker.
  const searchPending = searching && !searchFailed && searchResults.data === undefined

  // The visibility group restricting a category, by slug, and its label — the
  // marker names the group, not the category. Only ever populated for a
  // category this user holds: /api/catalog drops the ones they don't
  // (docs/specs/service-visibility.md §2.2).
  // A handful of entries, so a plain derivation: the React Compiler memoizes
  // it, and a manual useMemo here is what it refused to preserve once the
  // facet heading's own memo (issue #182) no longer sat beside it.
  const groupLabels: Record<string, string> = {}
  for (const e of me.visibility.entries) groupLabels[e.slug] = localized(e.label, locale)
  const restrictedBy = (slug: string): string | undefined => {
    const group = allCategories.find((c) => c.slug === slug)?.visibility
    return group ? groupLabels[group] ?? group : undefined
  }

  // Announce only settled numbers: see useResultAnnouncement. The key names
  // *what* produced the count (search text, or the active tab/filter) so a
  // new search that happens to match the previous result count still
  // announces, while a re-render of the same settled search (e.g. a locale
  // switch) does not.
  const countSettled = !catalog.isLoading && !favorites.isLoading && !searchPending && !searchFailed
  const settleKey = searching
    ? `search:${debouncedQuery}`
    : tab === 'favoriten'
      ? 'favoriten'
      : filter.kind === 'category'
        ? `category:${filter.slug}`
        : filter.kind
  const resultAnnouncement = useResultAnnouncement(
    countSettled ? results.length : null,
    tr.dash.resultCount(results.length),
    settleKey,
  )

  // Section heading for the current view — a search, and only a search. Every
  // other view is already named on screen: the unfiltered Favoriten / Alle
  // Dienste views by the active tab (issue #170), and every facet — "In
  // Wartung", "Beta", a category — by its own highlighted pill directly above
  // the list (issue #182). A heading over a facet was the same name twice, and
  // because the unfiltered view had none, selecting a category pushed the
  // pills and every card down by the heading's height and back again on
  // "Alle". A search has no pill, so "Suchergebnisse" stays: it is what tells
  // the reader why neither tab is highlighted and why these services are not
  // the list they were just looking at.
  const showHeading = searching

  const favCount = favoriteServices.length
  // `tab === 'favoriten'` for the same reason as the other two guards: arrange
  // is an edit mode *of the favorites list*, and nothing ever cleared the flag
  // on a navigation, so without it the mode followed the user onto the Dienste
  // tab — where it renders no bar of its own but still suppresses the tab row
  // below (issue #198, docs/specs/search-view-state.md §1).
  const arranging =
    arrangeRequested && tab === 'favoriten' && me.favorites_order === 'manual' && favCount > 0
  const firstName = me.display_name.split(' ')[0]

  // The sort trigger rides on the right of the tab row (issue #170; it sat
  // beside the "Favoriten" heading the row replaced, issue #125): it makes
  // usage/alpha discoverable and manual reachable, and it is what opens the
  // Anordnen edit mode. Favorites-only, and hidden while searching — a search
  // is global, so it is not the favorites list being ordered.
  const showSortMenu = !searching && tab === 'favoriten'
  const sortMenu = showSortMenu && (
    <FavoritesSortMenu
      locale={locale}
      order={me.favorites_order}
      onSetOrder={(next) => prefs.mutate({ favorites_order: next })}
      onArrange={() => setArrangeRequested(true)}
      canArrange={favCount > 0}
      isMobile={isMobile}
    />
  )

  // Switching the view always returns to the dashboard — out of the admin view
  // and out of search mode (a switch during a search cancels the search). Also
  // clears the filter: filter ≠ all implies the Dienste tab, which is what keeps
  // the view's URL unambiguous.
  const onTab = (next: Tab) => {
    clearSearch()
    navigate({ tab: next, filter: { kind: 'all' }, admin: false })
  }

  const adminOpen = view.admin && me.is_admin

  // Reaching the field. On a desktop it is already in the bar, so this is a
  // plain focus; on a phone it has to be revealed first — and the reveal is
  // flushed synchronously so focus() still happens inside the user gesture
  // that asked for it. iOS only raises the keyboard for a focus it can trace
  // back to a tap, and a focus scheduled after React's normal async render
  // no longer counts as one.
  // The reveal is phone state, so only a phone sets it: on a desktop the field
  // is already in the bar, and a ⌘K that set the flag there was what left the
  // overlay waiting to spring open on the next narrow resize (issue #198).
  const openSearch = useCallback(() => {
    if (isMobile) flushSync(() => setSearchOpen(true))
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [isMobile])
  // ⌘K / Ctrl+K, and "/" when nothing is being typed into. Off in the admin
  // view, which has no search field to focus (see DashboardShell's `search`).
  useSearchHotkeys(openSearch, !adminOpen)

  const globalSearch = (
    <GlobalSearch
      locale={locale}
      isMobile={isMobile}
      value={query}
      onChange={onSearch}
      inputRef={searchInputRef}
      open={phoneSearchOpen}
      onOpen={openSearch}
      onClose={clearSearch}
    />
  )

  const shellProps = {
    branding,
    me,
    locale,
    isDark,
    theme: me.theme,
    onSetTheme: (next: Me['theme']) => prefs.mutate({ theme: next }),
    onSetLocale: (next: Me['locale']) => prefs.mutate({ locale: next }),
    onAdmin: () => navigate({ ...view, admin: true }),
    isMobile,
    showBeta: me.show_beta,
    onSetShowBeta: (next: boolean) => prefs.mutate({ show_beta: next }),
    focusKey: adminOpen ? 'admin' : 'dashboard',
  }

  // The assistant launcher floats via position:fixed, so its spot in the tree is
  // cosmetic — but it must sit at the same position in both returns so React
  // keeps it mounted (panel state intact) when toggling the admin view.
  const assistant = assistantEnabled(branding) && (
    <AssistantWidget
      widgetUrl={branding.assistant_widget_url}
      botId={branding.assistant_bot_id}
      locale={locale}
      isDark={isDark}
    />
  )

  if (adminOpen && me.is_admin) {
    return (
      <>
        <DashboardShell {...shellProps}>
          <AdminView locale={locale} onExit={() => navigate({ ...view, admin: false })} />
        </DashboardShell>
        {assistant}
      </>
    )
  }

  return (
    <>
    {/* `search` only here, not on the admin shell above: the app-bar field
        searches the catalogue, and the admin surface isn't it. */}
    {/* `searchOpen` only matters on a phone: there the revealed field is laid
        over the whole app-bar row, and the bar's actions go inert under it
        (TopBar). Both consumers take the same reconciled value — see
        phoneSearchOpen — so the overlay and the inertness it implies can never
        disagree, and neither survives into the layout that renders no overlay
        at all (issue #198). */}
    <DashboardShell {...shellProps} search={globalSearch} searchOpen={phoneSearchOpen} watermark>
      <Greeting
        firstName={firstName}
        locale={locale}
        isMobile={isMobile}
        maintenanceCount={maintenanceCount}
        onShowMaintenance={showMaintenance}
      />

      {/* One-time PWA install hint (smartphones only; issue #42) */}
      <PwaInstallHint isMobile={isMobile} locale={locale} />

      {/* Announcements (inside max-width column, between greeting and content) */}
      {(announcements.data?.announcements ?? []).length > 0 && (
        <div style={{ marginBottom: isMobile ? 18 : 24 }}>
          <AnnouncementBanner announcements={announcements.data!.announcements} locale={locale} />
        </div>
      )}

      {/* The view switch (issue #170): an underline tab row directly above the
          list it controls, carrying each set's count and the favorites sort
          control. It sits where the old "Favoriten" heading row sat — and so
          it inherits that row's behaviour in the arrange edit mode below:
          arrange brings its own Abbrechen · Anordnen · Fertig bar and owns the
          view, and two stacked control rows ate too much phone screen
          (#125/#127). Counts are the full visible sets, not the filtered ones,
          and are omitted until their query has answered. */}
      {!arranging && (
        <LauncherTabs
          locale={locale}
          // Search results are their own view (global, across all services), so
          // neither tab is current while a query is active.
          tab={searching ? null : tab}
          onTab={onTab}
          favCount={favorites.data ? favCount : undefined}
          allCount={catalog.data ? allServices.length : undefined}
          sort={sortMenu || undefined}
          isMobile={isMobile}
        />
      )}

      {/* Section head: "Suchergebnisse", for the one view nothing else names
          (see showHeading). It renders on a phone too: the in-content search
          field moved into the app bar (issue #171), so this is what a phone
          reader has. */}
      {!arranging && showHeading && (
        <h2
          style={{
            margin: '0 0 18px',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            minWidth: 0,
          }}
        >
          {tr.dash.searchResults}
        </h2>
      )}

      {/* Single-select filters: desktop only (mobile relies on search). Hidden
          while searching, since a search is global and deactivates filters.
          Every facet is gated on having something to show (issue #139). */}
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
          {showMaintenanceFacet && (
            <PillButton
              active={filter.kind === 'maintenance'}
              aria-pressed={filter.kind === 'maintenance'}
              onClick={() => selectFilter({ kind: 'maintenance' })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Wrench className="h-[13px] w-[13px]" aria-hidden="true" />
              {tr.dash.inMaintenance}
            </PillButton>
          )}
          {/* Beta: the parallel of the maintenance facet, and on the same two
              conditions — the user asked for beta services (with the pref off
              the catalog carries none) and at least one is actually there. */}
          {showBetaFacet && (
            <PillButton
              active={filter.kind === 'beta'}
              aria-pressed={filter.kind === 'beta'}
              onClick={() => selectFilter({ kind: 'beta' })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FlaskConical className="h-[13px] w-[13px]" aria-hidden="true" />
              {tr.dash.betaServices}
            </PillButton>
          )}
          {allCategories.map((c) => {
            // A lock, not a second label: the pill keeps the name and the width
            // the touch target and the 324px strip were tuned for, and the
            // meaning rides in the button's accessible name.
            const group = restrictedBy(c.slug)
            return (
              <PillButton
                key={c.slug}
                active={filter.kind === 'category' && filter.slug === c.slug}
                aria-pressed={filter.kind === 'category' && filter.slug === c.slug}
                onClick={() => selectFilter({ kind: 'category', slug: c.slug })}
              >
                {localized(c.label, locale)}
                {/* A margin rather than a flex gap: the pill stays the block
                    button every other pill is, so a restricted one lines up
                    with its neighbours to the pixel and the 44px box is
                    untouched. */}
                {group && <RestrictedMarker className="ml-1.5 align-middle" srLabel={tr.common.restrictedTo(group)} />}
              </PillButton>
            )
          })}
        </div>
      )}

      {/* Polite live region: announces the result count when a search/filter/tab
          change alters what's shown, then goes quiet again — see
          useResultAnnouncement. Silent on first render. */}
      <div aria-live="polite" role="status" className="sr-only">
        {resultAnnouncement}
      </div>

      {/* Content: a search shows global results from the server; otherwise the
          active tab/filter. Favorites render their own list; everything else
          needs the catalog. */}
      {!searching && tab === 'favoriten' ? (
        arranging ? (
          <FavoritesArrange
            services={favoriteServices}
            locale={locale}
            onReorder={(serviceIDs) => favOrder.mutate(serviceIDs)}
            onDone={() => setArrangeRequested(false)}
            onCancel={() => setArrangeRequested(false)}
          />
        ) : (
          <CatalogView
            services={results}
            categories={allCategories}
            locale={locale}
            layout={layout}
            actions={actions}
            emptyMessage={tr.dash.favEmpty}
          />
        )
      ) : searchFailed ? (
        <p style={{ fontSize: 14, color: 'var(--danger)' }} role="alert">{tr.dash.searchError}</p>
      ) : searchPending ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }} role="status" aria-busy="true">{tr.dash.searching}</p>
      ) : !searching && catalog.isLoading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }} role="status" aria-busy="true">{tr.common.loading}</p>
      ) : searching ? (
        // Grouped by set (issue #171): the hits say which side of the
        // Favoriten / Alle Dienste line they fell on, so a global search never
        // pretends to be local. Ranking stays the server's inside each group.
        <SearchResults
          services={results}
          favoritedIDs={favoritedIDs}
          categories={allCategories}
          locale={locale}
          layout={layout}
          actions={actions}
          emptyMessage={tr.dash.searchEmpty(query)}
        />
      ) : (
        <CatalogView
          services={results}
          categories={allCategories}
          locale={locale}
          layout={layout}
          actions={actions}
        />
      )}
    </DashboardShell>
    {assistant}
    </>
  )
}
