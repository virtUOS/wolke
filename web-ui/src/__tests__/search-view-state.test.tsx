import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BRANDING } from '@/test/branding'
import type { Me, Service } from '@/lib/api'
import { Dashboard } from '@/components/Dashboard'

// Issue #198 — the two view-state rules of docs/specs/search-view-state.md.
//
// Both defects live in the #170/#171 seam: the tab row moved above the list and
// the search field moved into the app bar, and neither PR knew about the state
// the other one was sharing.
//
//   A. A search and the Anordnen edit mode could be open at once, and arrange
//      mode leaked out of the Favoriten tab entirely — `arrangeRequested` has
//      no writer on any navigation path (spec §1).
//   B. `searchOpen` and `query` are one pair of states across two layouts that
//      render them differently; only one layout renders `searchOpen` at all.
//
// These are Dashboard-level rules — which view wins — so they are asserted
// through the real Dashboard, not through the two components in isolation.

const ME: Me = {
  id: 'u1',
  display_name: 'Alex Beispiel',
  primary_role: 'student',
  is_admin: false,
  view_mode: 'list',
  theme: 'light',
  locale: 'de',
  // Manual is the only order that offers the edit mode at all, so it is the
  // default here — every test in this file is about that mode or about search.
  favorites_order: 'manual',
  favorites_separate_tab: false,
  show_beta: false,
  visibility: { held: [], entries: [] },
}

function service(id: string, name: string, tag?: Service['tag']): Service {
  return {
    id,
    name,
    description: { de: `${name} Beschreibung`, en: `${name} description` },
    service_url: `https://${id}.example.edu`,
    doc_url: '',
    icon: 'shield',
    categories: ['infra'],
    doc_only: false,
    ...(tag ? { tag } : {}),
  }
}

const GITLAB = service('s1', 'GitLab')
const VPN = service('s2', 'VPN')
// Tagged `wartung` so the greeting offers its "n Dienste in Wartung" shortcut:
// with the tab row hidden by arrange mode, that button is one of the two ways a
// user can still leave the Favoriten view (the other is Back).
const HISINONE = service('s3', 'HISinOne', 'wartung')

const CATEGORIES = [{ slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 10 }]

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function setURL(path: string) {
  window.history.replaceState(null, '', path)
}

/**
 * A `matchMedia` whose answer can be flipped mid-test, unlike the static stubs
 * the other suites use.
 *
 * Crossing the breakpoint is the subject here, and `useIsMobile` learns about a
 * crossing exactly one way: the `change` event on the MediaQueryList it
 * subscribed to. So the stub keeps the real listeners and dispatches to them,
 * and `matches` is a getter — the handler reads `mql.matches` off the object it
 * subscribed with, not off the event.
 */
function stubMatchMedia(initiallyMobile: boolean) {
  let mobile = initiallyMobile
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query.includes('min-width') ? !mobile : false
    },
    media: query,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia

  /** Crosses the 768px breakpoint, the way a rotate or a window resize does. */
  return function resizeTo(nextMobile: boolean) {
    mobile = nextMobile
    act(() => {
      for (const fn of [...listeners]) fn({ matches: !nextMobile } as MediaQueryListEvent)
    })
  }
}

interface StubOptions {
  mobile?: boolean
  favorites?: Service[]
  results?: Service[]
}

function stubFetch(opts: StubOptions = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/catalog')) {
        return jsonResponse({ services: [GITLAB, VPN, HISINONE], categories: CATEGORIES })
      }
      if (url.startsWith('/api/search')) return jsonResponse({ query: 'git', services: opts.results ?? [GITLAB] })
      if (url.startsWith('/api/favorites')) return jsonResponse({ services: opts.favorites ?? [GITLAB, VPN] })
      if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
      if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
      return jsonResponse({})
    }),
  )
}

function renderDashboard(me: Me = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard branding={BRANDING} me={me} />
    </QueryClientProvider>,
  )
}

const tabRow = () => screen.queryByRole('navigation', { name: 'Hauptnavigation' })
const arrangeBar = () => screen.queryByRole('button', { name: 'Fertig' })
const searchField = () => screen.queryByRole('searchbox', { name: 'Alle Dienste durchsuchen' })
// „Suchen: Alle Dienste durchsuchen" — the pill names the action it performs
// and then the field it reveals, so it is matched loosely and the field, whose
// name is only the second half, exactly.
const searchPill = () => within(screen.getByRole('banner')).getByRole('button', { name: /^Suchen:/ })
const querySearchPill = () => within(screen.getByRole('banner')).queryByRole('button', { name: /^Suchen:/ })
const resultsHeading = () => screen.queryByRole('heading', { level: 2, name: 'Suchergebnisse' })

/** Enters the Anordnen edit mode through the control a user actually uses. */
async function startArranging(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(tabRow()).toBeVisible())
  await user.click(await screen.findByRole('button', { name: /Reihenfolge:/ }))
  await user.click(await screen.findByRole('button', { name: 'Anordnen' }))
  await waitFor(() => expect(arrangeBar()).toBeVisible())
}

afterEach(() => {
  setURL('/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Rule A: a search cancels arrange (spec §2) ──────────────────────────────

describe('a search and the Anordnen edit mode cannot coexist (issue #198)', () => {
  it('typing a query cancels arrange, and clearing the query does not bring it back', async () => {
    stubMatchMedia(false)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()
    await startArranging(user)

    // The app-bar field stays reachable during arrange — that is deliberate
    // (spec §2: search is the view that overrides every other view). What it
    // must do is end the edit mode rather than sit beside it.
    await user.type(searchField()!, 'git')
    await waitFor(() => expect(resultsHeading()).toBeVisible())
    expect(arrangeBar()).toBeNull()

    // Cancelled, not suppressed: standing down from the search lands on the
    // ordinary Favoriten list, with the tab row back.
    await user.clear(searchField()!)
    await waitFor(() => expect(tabRow()).toBeVisible())
    expect(arrangeBar()).toBeNull()
    expect(resultsHeading()).toBeNull()
  })

  it('never renders the arrange bar and the search results at the same time', async () => {
    stubMatchMedia(false)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()
    await startArranging(user)

    // Assert through the whole transition, keystroke by keystroke, rather than
    // only at its ends: the defect was a frame in which both were mounted.
    for (const ch of 'git') {
      await user.type(searchField()!, ch)
      expect(arrangeBar() !== null && resultsHeading() !== null).toBe(false)
    }
    await waitFor(() => expect(resultsHeading()).toBeVisible())
    expect(arrangeBar()).toBeNull()
  })

  it('leaves the edit mode behind when the view navigates away from Favoriten', async () => {
    stubMatchMedia(false)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()
    await startArranging(user)

    // The tab row is hidden while arranging, so the greeting's maintenance
    // shortcut is the navigation still on screen. Arrange mode belongs to the
    // favorites list; on the Dienste tab there must be a tab row and no bar
    // (spec §1, the half the issue did not report).
    await user.click(screen.getByRole('button', { name: '1 Dienst in Wartung' }))
    await waitFor(() => expect(tabRow()).toBeVisible())
    expect(arrangeBar()).toBeNull()
  })
})

// ── Rule B: crossing the 768px breakpoint (spec §3) ─────────────────────────

describe('search state across the 768px breakpoint (issue #198)', () => {
  it('carries a desktop query into the phone layout with the field revealed', async () => {
    const resizeTo = stubMatchMedia(false)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    await user.type(await screen.findByRole('searchbox', { name: 'Alle Dienste durchsuchen' }), 'git')
    await waitFor(() => expect(resultsHeading()).toBeVisible())

    resizeTo(true)

    // The typed text survives the rotate — losing it is the worse failure — and
    // it arrives visible and clearable rather than filtering the list from a
    // field that is not on screen.
    await waitFor(() => expect(searchField()).toHaveValue('git'))
    expect(screen.getByRole('button', { name: 'Suche schließen' })).toBeVisible()
    expect(resultsHeading()).toBeVisible()
  })

  it('does not pop the phone overlay for a ⌘K pressed in the desktop layout', async () => {
    const resizeTo = stubMatchMedia(false)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(searchField()).toBeVisible())
    await user.keyboard('{Control>}k{/Control}')
    expect(searchField()).toHaveFocus()

    resizeTo(true)

    // `searchOpen` is phone state. With no query behind it there is nothing for
    // the phone layout to reveal, so the bar shows its collapsed pill.
    await waitFor(() => expect(searchPill()).toBeVisible())
    expect(searchField()).toBeNull()
    expect(searchPill()).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries a phone query into the desktop bar and drops the overlay with it', async () => {
    const resizeTo = stubMatchMedia(true)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(searchPill()).toBeVisible())
    await user.click(searchPill())
    await user.type(searchField()!, 'git')
    await waitFor(() => expect(resultsHeading()).toBeVisible())

    resizeTo(false)

    await waitFor(() => expect(searchField()).toHaveValue('git'))
    // The desktop has no overlay, so neither its ✕ nor the pill it covers is
    // left over from the layout that did.
    expect(screen.queryByRole('button', { name: 'Suche schließen' })).toBeNull()
    expect(querySearchPill()).toBeNull()
    expect(resultsHeading()).toBeVisible()
  })

  it('does not restore an empty phone overlay after a round trip through the desktop', async () => {
    const resizeTo = stubMatchMedia(true)
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(searchPill()).toBeVisible())
    await user.click(searchPill())
    await waitFor(() => expect(searchField()).toBeVisible())

    resizeTo(false)
    await waitFor(() => expect(searchField()).toBeVisible())
    resizeTo(true)

    // Nothing about the overlay outlived the layout that renders it, in either
    // direction — the flag was reconciled at the crossing, not carried.
    await waitFor(() => expect(searchPill()).toBeVisible())
    expect(searchField()).toBeNull()
    expect(searchPill()).toHaveAttribute('aria-expanded', 'false')
  })
})
