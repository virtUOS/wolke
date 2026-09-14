import { render, screen } from '@testing-library/react'
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
}

function stubFetch(opts: StubOptions = {}) {
  stubMatchMedia(opts.mobile)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/catalog')) {
        return jsonResponse({ services: [GITLAB, PAGES, GITKURS], categories: CATEGORIES })
      }
      if (url.startsWith('/api/search')) {
        return jsonResponse({ query: 'git', services: opts.results ?? [GITLAB, PAGES, GITKURS] })
      }
      if (url.startsWith('/api/favorites')) return jsonResponse({ services: opts.favorites ?? [] })
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
