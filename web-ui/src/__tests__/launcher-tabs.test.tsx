import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import type { Me, Service } from '@/lib/api'
import { Dashboard } from '@/components/Dashboard'
import { LauncherTabs } from '@/components/LauncherTabs'
import { Greeting } from '@/components/Greeting'

// Issue #170: the Favoriten / Alle Dienste switch leaves the app bar and becomes
// an underline tab row directly above the list, carrying the item counts, with
// the favorites sort control on its right.
//
// The row keeps the *navigation* semantics the pills had (buttons +
// aria-current, issue #29 — switching pushes a history entry), and takes only
// the underline look from the design: no role="tab"/"tabpanel", which would
// promise an arrow-key model that isn't there. These tests pin that decision
// down so it isn't "fixed" back into a tablist.

const BRANDING: Branding = {
  product_name: 'wolke',
  org_name: 'Universität Osnabrück',
  logo_light: '',
  logo_dark: '',
  favicon: '',
  default_locale: 'de',
  imprint_url: '',
  privacy_url: '',
  feedback_url: '',
  bot_url: '',
  help_url: '',
  assistant_widget_url: '',
  assistant_bot_id: '',
  theme: { light: {}, dark: {} },
}

const ME: Me = {
  id: 'u1',
  display_name: 'Alex Beispiel',
  primary_role: 'student',
  is_admin: false,
  view_mode: 'list',
  theme: 'light',
  locale: 'de',
  favorites_order: 'usage',
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

const CATALOG = {
  services: [
    service('s1', 'VPN'),
    service('s2', 'Stud.IP'),
    service('s3', 'GitLab'),
    service('s4', 'HISinOne', 'wartung'),
  ],
  categories: [{ slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 10 }],
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function setURL(path: string) {
  window.history.replaceState(null, '', path)
}

/** Desktop unless `mobile`, so the category pills and the wide layout render. */
function stubMatchMedia(mobile = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width') ? !mobile : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

/** Serves the catalog plus a mutable favorites set, so a star toggle in the
 *  list is actually reflected by the next /api/favorites read — which is what
 *  makes the tab count follow it. */
function stubApi(initialFavorites: Service[]) {
  let favorites = [...initialFavorites]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/catalog')) return jsonResponse(CATALOG)
      if (url.startsWith('/api/favorites')) {
        if (method === 'POST' || method === 'DELETE') {
          // Both take { service_id } in the body (api.addFavorite/removeFavorite).
          const { service_id: id } = JSON.parse(String(init?.body ?? '{}'))
          const service = CATALOG.services.find((s) => s.id === id)
          if (service) {
            favorites = method === 'POST' ? [...favorites, service] : favorites.filter((s) => s.id !== id)
          }
          return jsonResponse({})
        }
        return jsonResponse({ services: favorites })
      }
      if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
      if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
      return jsonResponse({})
    }),
  )
  return { count: () => favorites.length }
}

function renderDashboard(me: Me = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard branding={BRANDING} me={me} />
    </QueryClientProvider>,
  )
}

/** The tab row, located the way a user finds it: the navigation above the list. */
function tabRow() {
  return screen.getByRole('navigation', { name: 'Hauptnavigation' })
}

const favTab = () => within(tabRow()).getByRole('button', { name: /^Favoriten/ })
const allTab = () => within(tabRow()).getByRole('button', { name: /^Alle Dienste/ })

afterEach(() => {
  setURL('/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── The row itself, prop-driven ─────────────────────────────────────────────

describe('LauncherTabs', () => {
  const noop = () => {}

  it('renders both labels with their counts', () => {
    render(<LauncherTabs locale="de" tab="favoriten" onTab={noop} favCount={4} allCount={38} isMobile={false} />)
    expect(favTab()).toHaveTextContent(/^Favoriten\s*4$/)
    expect(allTab()).toHaveTextContent(/^Alle Dienste\s*38$/)
  })

  it('omits a count that has not loaded yet rather than flashing a zero', () => {
    render(<LauncherTabs locale="de" tab="favoriten" onTab={noop} isMobile={false} />)
    expect(favTab()).toHaveTextContent(/^Favoriten$/)
    expect(allTab()).toHaveTextContent(/^Alle Dienste$/)
  })

  it('marks the active tab with aria-current, not aria-selected', () => {
    render(<LauncherTabs locale="de" tab="favoriten" onTab={noop} favCount={4} allCount={38} isMobile={false} />)
    expect(favTab()).toHaveAttribute('aria-current', 'page')
    expect(allTab()).not.toHaveAttribute('aria-current')
    expect(favTab()).not.toHaveAttribute('aria-selected')
  })

  // Settled decision 1 in the issue: these are navigation controls (a switch
  // changes the URL and pushes a history entry), so they must not claim the
  // tablist pattern whose arrow-key model they don't implement.
  it('is a nav of plain buttons — no tablist/tab/tabpanel roles', () => {
    const { baseElement } = render(
      <LauncherTabs locale="de" tab="dienste" onTab={noop} favCount={4} allCount={38} isMobile={false} />,
    )
    expect(baseElement.querySelector('[role="tablist"]')).toBeNull()
    expect(baseElement.querySelector('[role="tab"]')).toBeNull()
    expect(baseElement.querySelector('[role="tabpanel"]')).toBeNull()
  })

  it('highlights no tab while a search is active (tab = null)', () => {
    render(<LauncherTabs locale="de" tab={null} onTab={noop} favCount={4} allCount={38} isMobile={false} />)
    expect(favTab()).not.toHaveAttribute('aria-current')
    expect(allTab()).not.toHaveAttribute('aria-current')
  })

  it('is keyboard operable: tab to a control, Enter activates it', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    render(<LauncherTabs locale="de" tab="favoriten" onTab={onTab} favCount={4} allCount={38} isMobile={false} />)
    await user.tab()
    expect(favTab()).toHaveFocus()
    await user.tab()
    expect(allTab()).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onTab).toHaveBeenCalledWith('dienste')
    await user.keyboard(' ')
    expect(onTab).toHaveBeenCalledTimes(2)
  })

  it('renders the sort slot when given one', () => {
    render(
      <LauncherTabs
        locale="de"
        tab="favoriten"
        onTab={noop}
        favCount={4}
        allCount={38}
        isMobile={false}
        sort={<button type="button">Reihenfolge</button>}
      />,
    )
    expect(within(tabRow()).getByRole('button', { name: 'Reihenfolge' })).toBeVisible()
  })
})

// ── The row inside the dashboard ────────────────────────────────────────────

describe('Dashboard launcher tab row (issue #170)', () => {
  beforeEach(() => stubMatchMedia())

  it('shows the full visible sets as counts, not the filtered ones', async () => {
    stubApi([CATALOG.services[0], CATALOG.services[1]])
    setURL('/?tab=dienste&cat=infra')
    renderDashboard()

    await waitFor(() => expect(allTab()).toHaveTextContent(/Alle Dienste\s*4/))
    expect(favTab()).toHaveTextContent(/Favoriten\s*2/)
  })

  it('updates the favorites count when a favorite is toggled', async () => {
    stubApi([CATALOG.services[0]])
    setURL('/?tab=dienste')
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(favTab()).toHaveTextContent(/Favoriten\s*1/))
    await user.click(await screen.findByRole('button', { name: /Stud\.IP zu Favoriten hinzufügen/ }))
    await waitFor(() => expect(favTab()).toHaveTextContent(/Favoriten\s*2/))
  })

  it('switches the view and moves aria-current with it', async () => {
    stubApi([CATALOG.services[0]])
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(favTab()).toHaveAttribute('aria-current', 'page'))
    await user.click(allTab())
    expect(window.location.search).toBe('?tab=dienste')
    expect(allTab()).toHaveAttribute('aria-current', 'page')
    expect(favTab()).not.toHaveAttribute('aria-current')
  })

  it('no longer offers the view switch in the app bar', async () => {
    stubApi([CATALOG.services[0]])
    renderDashboard()

    await waitFor(() => expect(favTab()).toBeVisible())
    // Exactly one Favoriten control on the page: the tab. The app bar's pill is gone.
    expect(screen.getAllByRole('button', { name: /^Favoriten/ })).toHaveLength(1)
    expect(screen.getByRole('banner')).not.toContainElement(favTab())
  })

  // Settled decision 3: the sort control is favorites-only; its slot must not
  // move the tabs when it comes and goes.
  it('offers the sort control on Favoriten only', async () => {
    stubApi([CATALOG.services[0]])
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(within(tabRow()).getByRole('button', { name: /Reihenfolge:/ })).toBeVisible())
    await user.click(allTab())
    expect(within(tabRow()).queryByRole('button', { name: /Reihenfolge:/ })).toBeNull()
    // The row keeps its reserved slot, so the tabs don't shift.
    expect(tabRow().querySelector('[data-sort-slot]')).not.toBeNull()
  })

  // Settled decision 2: arrange owns the view (issue #125/#127) — the tab row
  // inherits what the Favoriten header row did and steps aside while arranging.
  it('hides the tab row while arranging and brings it back afterwards', async () => {
    stubApi([CATALOG.services[0], CATALOG.services[1]])
    const user = userEvent.setup()
    renderDashboard({ ...ME, favorites_order: 'manual' })

    await waitFor(() => expect(favTab()).toBeVisible())
    await user.click(within(tabRow()).getByRole('button', { name: /Reihenfolge:/ }))
    await user.click(await screen.findByRole('button', { name: 'Anordnen' }))

    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Hauptnavigation' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Fertig' }))
    await waitFor(() => expect(favTab()).toBeVisible())
  })

  it('drops the redundant Favoriten section heading', async () => {
    stubApi([CATALOG.services[0]])
    renderDashboard()

    await waitFor(() => expect(favTab()).toBeVisible())
    expect(screen.queryByRole('heading', { level: 2, name: 'Favoriten' })).toBeNull()
  })

  // #171 moves the search field; #170 must leave it exactly where it is.
  it('keeps the in-content search field', async () => {
    stubApi([CATALOG.services[0]])
    renderDashboard()
    expect(await screen.findByRole('searchbox', { name: 'Alle Dienste durchsuchen' })).toBeVisible()
  })
})

// ── The greeting loses one shortcut, keeps the other ────────────────────────

describe('Greeting after the tab row took over the favorites count', () => {
  it('no longer offers the favorites shortcut but still offers maintenance', async () => {
    const user = userEvent.setup()
    const onShowMaintenance = vi.fn()
    render(
      <Greeting
        firstName="Timo"
        locale="de"
        isMobile={false}
        maintenanceCount={2}
        onShowMaintenance={onShowMaintenance}
      />,
    )
    expect(screen.queryByRole('button', { name: /Favorit/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: '2 Dienste in Wartung' }))
    expect(onShowMaintenance).toHaveBeenCalled()
  })
})
