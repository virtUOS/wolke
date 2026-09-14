import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import type { Me, Service } from '@/lib/api'
import { Dashboard } from '@/components/Dashboard'

// Issue #171: search becomes explicitly *global* and its entry point moves into
// the app bar.
//
// The two settled decisions the issue makes are what these tests guard:
//   1. search stays server-side (/api/search) — never a browser-side filter of
//      the catalog, which would stop matching the admin keywords the catalog
//      deliberately never ships;
//   2. search stays a *view* — results render in the content area under
//      "Suchergebnisse", with the pending/failed states, the settled-count
//      announcement, the clear-on-plain-click rule (#26/#27) and search's
//      absence from the URL all intact. Only the entry point moved.

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

function service(id: string, name: string, description: string): Service {
  return {
    id,
    name,
    description: { de: description, en: description },
    service_url: `https://${id}.example.edu`,
    doc_url: '',
    icon: 'shield',
    categories: ['infra'],
    doc_only: false,
  }
}

const GITLAB = service('s1', 'GitLab', 'Selbst gehostetes GitLab')
const PAGES = service('s2', 'GitLab Pages', 'Statische Webseiten aus Repositories')
const GITKURS = service('s3', 'Digitale Lehre: Git-Kurs', 'Selbstlernkurs im Stud.IP')

const VPN = service('s4', 'VPN', 'Zugang von außerhalb')

const CATEGORIES = [{ slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 10 }]

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function setURL(path: string) {
  window.history.replaceState(null, '', path)
}

/** Desktop unless `mobile` — the two entry points differ, so every test says
 *  which layout it is in. */
function stubMatchMedia(mobile = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width') ? !mobile : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

interface StubOptions {
  mobile?: boolean
  /** Services /api/search answers with, in server rank order. */
  results?: Service[]
  /** Services /api/favorites answers with. */
  favorites?: Service[]
  /** Make /api/search fail, to reach the error state. */
  searchFails?: boolean
  /** Holds /api/search open, to reach and hold the pending state. */
  searchGate?: Promise<void>
}

/** Every /api/search URL the app asked for — so "search stays server-side" is
 *  an assertion, not an assumption. */
let searchCalls: string[] = []

function stubFetch(opts: StubOptions = {}) {
  stubMatchMedia(opts.mobile)
  searchCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/catalog')) {
        return jsonResponse({ services: [GITLAB, PAGES, GITKURS], categories: CATEGORIES })
      }
      if (url.startsWith('/api/search')) {
        searchCalls.push(url)
        if (opts.searchGate) await opts.searchGate
        if (opts.searchFails) return new Response('nope', { status: 503 })
        return jsonResponse({ query: 'git', services: opts.results ?? [GITLAB, PAGES, GITKURS] })
      }
      if (url.startsWith('/api/favorites')) return jsonResponse({ services: opts.favorites ?? [] })
      if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
      if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
      return jsonResponse({})
    }),
  )
}

/** The dashboard's polite result-count region (issue #35). Addressed by
 *  aria-live rather than by role, because the pending state is a role="status"
 *  paragraph too. */
function liveRegion(): HTMLElement {
  const el = document.querySelector('[aria-live="polite"]')
  if (!el) throw new Error('no polite live region on the page')
  return el as HTMLElement
}

function renderDashboard(me: Me = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard branding={BRANDING} me={me} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  setURL('/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── The string that is the smallest, truest fix for the reported finding ─────
//
// The field said "Dienste durchsuchen" while the Favoriten tab was active and
// then returned hits from outside that tab. The results view already says
// "Suchergebnisse" and already highlights no tab; what was left to fix is the
// promise the field itself makes.
describe('the search field says it searches everything (issue #171)', () => {
  it('desktop: placeholder and accessible name name the whole catalogue', async () => {
    stubFetch()
    renderDashboard()

    const search = await screen.findByRole('searchbox')
    expect(search).toHaveAttribute('placeholder', 'Alle Dienste durchsuchen')
    expect(search).toHaveAccessibleName(/Alle Dienste durchsuchen/)
  })
})

// ── The entry point moves; the destination does not ─────────────────────────

describe('the entry point lives in the app bar (issue #171)', () => {
  it('desktop: the field is in the banner, and nothing is left in the content', async () => {
    stubFetch()
    renderDashboard()

    const search = await screen.findByRole('searchbox')
    expect(within(screen.getByRole('banner')).getByRole('searchbox')).toBe(search)
    expect(within(screen.getByRole('main')).queryByRole('searchbox')).toBeNull()
  })

  it('mobile: a "Suchen" pill in the bar reveals the field and focuses it', async () => {
    stubFetch({ mobile: true })
    const user = userEvent.setup()
    renderDashboard()

    const bar = within(screen.getByRole('banner'))
    // Nothing to type into until it is asked for — the phone bar has to hold
    // the wordmark, the bell and the avatar as well.
    expect(screen.queryByRole('searchbox')).toBeNull()

    const pill = await bar.findByRole('button', { name: /Alle Dienste durchsuchen/ })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    await user.click(pill)

    const search = bar.getByRole('searchbox')
    expect(search).toHaveAttribute('placeholder', 'Alle Dienste durchsuchen')
    expect(search).toHaveFocus()
  })

  it('mobile: closing the field puts the query away with it', async () => {
    stubFetch({ mobile: true })
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: /Alle Dienste durchsuchen/ }))
    await user.type(screen.getByRole('searchbox'), 'git')
    await waitFor(() => expect(screen.getByRole('link', { name: /GitLab Pages/ })).toBeVisible())

    await user.click(screen.getByRole('button', { name: 'Suche schließen' }))
    expect(screen.queryByRole('searchbox')).toBeNull()
    // Back on the tab the search was opened from, not on a stale result set.
    await waitFor(() => expect(screen.queryByRole('link', { name: /GitLab Pages/ })).toBeNull())
  })

  it('stays server-side: typing asks /api/search rather than filtering the catalogue', async () => {
    // The hit is a service whose name and description contain nothing of the
    // query: only the server sees the admin keywords that match it, so a
    // browser-side filter could not possibly return this.
    stubFetch({ results: [VPN] })
    const user = userEvent.setup()
    renderDashboard()

    await user.type(await screen.findByRole('searchbox'), 'eduroam')
    await waitFor(() => expect(screen.getByRole('link', { name: /VPN/ })).toBeVisible())
    expect(searchCalls.length).toBeGreaterThan(0)
    expect(searchCalls.at(-1)).toContain('eduroam')
    // …and only the server's answer is on screen, not a catalogue substring match.
    expect(screen.queryByRole('link', { name: /GitLab/ })).toBeNull()
  })
})

// ── What must survive the move ──────────────────────────────────────────────
//
// The issue's "do not lose these on the way" list. Search staying a *view* is
// what makes them cheap to keep — but the entry point moving changes who owns
// the query, so each one is pinned here rather than assumed.

describe('the results view is unchanged by the move (issue #171)', () => {
  it('a query heads the content "Suchergebnisse" and leaves both tabs unclaimed', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    await user.type(await screen.findByRole('searchbox'), 'git')
    await waitFor(() => expect(screen.getByRole('link', { name: /GitLab Pages/ })).toBeVisible())

    expect(screen.getByRole('heading', { level: 2, name: 'Suchergebnisse' })).toBeVisible()
    const nav = within(screen.getByRole('navigation', { name: /Hauptnavigation/ }))
    expect(nav.queryByRole('button', { current: 'page' })).toBeNull()
  })

  it('the same, on a phone — where the heading is now the only thing naming the view', async () => {
    stubFetch({ mobile: true })
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: /Alle Dienste durchsuchen/ }))
    await user.type(screen.getByRole('searchbox'), 'git')
    await waitFor(() => expect(screen.getByRole('link', { name: /GitLab Pages/ })).toBeVisible())
    expect(screen.getByRole('heading', { level: 2, name: 'Suchergebnisse' })).toBeVisible()
  })

  it('a failed /api/search shows an error, never a spinner that hangs', async () => {
    stubFetch({ searchFails: true })
    const user = userEvent.setup()
    renderDashboard()

    await user.type(await screen.findByRole('searchbox'), 'git')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Suche momentan nicht verfügbar/))
    expect(screen.queryByText('Suchen…')).toBeNull()
  })

  it('shows the pending state for the first results, and announces only the settled count', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => (release = r))
    stubFetch({ searchGate: gate })
    const user = userEvent.setup()
    renderDashboard()

    await user.type(await screen.findByRole('searchbox'), 'git')
    await waitFor(() => expect(screen.getByText('Suchen…')).toBeVisible())
    // Silent while in flight: an in-flight count is stale, and the live region
    // must not chatter at every keystroke (issue #35).
    expect(liveRegion()).toHaveTextContent('')

    release?.()
    await waitFor(() => expect(screen.getByRole('link', { name: /GitLab Pages/ })).toBeVisible())
    await waitFor(() => expect(liveRegion()).toHaveTextContent('3 Dienste'))
  })

  it('keeps the search out of the URL', async () => {
    stubFetch()
    const user = userEvent.setup()
    setURL('/?tab=dienste')
    renderDashboard()

    await user.type(await screen.findByRole('searchbox'), 'git')
    await waitFor(() => expect(screen.getByRole('link', { name: /GitLab Pages/ })).toBeVisible())
    expect(window.location.search).toBe('?tab=dienste')
  })

  it('a plain click on a result clears the query; a Ctrl-click does not (#26/#27)', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    const search = await screen.findByRole('searchbox')
    await user.type(search, 'git')
    await waitFor(() => expect(screen.getByRole('link', { name: /GitLab Pages/ })).toBeVisible())

    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('link', { name: /GitLab Pages/ }))
    await user.keyboard('{/Control}')
    expect(search).toHaveValue('git')

    await user.click(screen.getByRole('link', { name: /GitLab Pages/ }))
    await waitFor(() => expect(search).toHaveValue(''))
  })
})

// ── ⌘K and "/" ──────────────────────────────────────────────────────────────
//
// A global key handler that ignores layering is the bug PR #169 fixed. These
// pin the two suppressions that keep it from coming back.

describe('the keyboard shortcuts (issue #171)', () => {
  it('⌘K and "/" focus the field', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    const search = await screen.findByRole('searchbox')
    await user.click(document.body)
    await user.keyboard('{Control>}k{/Control}')
    expect(search).toHaveFocus()

    search.blur()
    await user.keyboard('/')
    expect(search).toHaveFocus()
    // "/" opened the field, it did not land in it.
    expect(search).toHaveValue('')
  })

  it('"/" stays a slash inside a text input', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    const search = await screen.findByRole('searchbox')
    await user.type(search, 'a/b')
    expect(search).toHaveValue('a/b')
  })

  it('neither fires while another overlay owns the keyboard', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderDashboard()

    const search = await screen.findByRole('searchbox')
    // The account menu is a role="dialog" that traps Tab and owns Escape.
    await user.click(screen.getByRole('button', { name: /Konto/ }))
    expect(await screen.findByRole('dialog')).toBeVisible()

    await user.keyboard('{Control>}k{/Control}')
    expect(search).not.toHaveFocus()
    await user.keyboard('/')
    expect(search).not.toHaveFocus()
  })
})
