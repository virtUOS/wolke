import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import type { Me } from '@/lib/api'
import { Dashboard } from '@/components/Dashboard'

// Dashboard-level regression coverage. Two concerns share the scaffold below,
// each with its own fetch fixture (scoped beforeEach):
//
// - Issue #31: switching tabs must reset both the query text and any active
//   category filter, whether the target tab was already active or not
//   (873f054, issue #29). view-history.test.tsx covers useViewHistory itself,
//   but not the onTab handler wired to it here.
// - Issue #27: launching a service from an open search, by a plain left click,
//   clears the search — but a deliberate new-tab gesture (Ctrl/Cmd/Shift-click)
//   or the doc link must leave it alone. Click tracking (recordClick) fires
//   unconditionally either way; these tests cover the query-clearing decision
//   made in Dashboard's `actions.onLaunch`, which Tile.test.tsx doesn't reach.

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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function setURL(path: string) {
  window.history.replaceState(null, '', path)
}

function renderDashboard(me: Me = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard branding={BRANDING} me={me} />
    </QueryClientProvider>,
  )
}

function stubMatchMedia() {
  // matchMedia is used for the desktop/mobile breakpoint and prefers-color-scheme.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'), // desktop layout, so the category pills render
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  setURL('/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Dashboard tab navigation resets the filter (issue #31)', () => {
  beforeEach(() => {
    stubMatchMedia()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.startsWith('/api/catalog')) {
          return jsonResponse({
            services: [
              {
                id: 's1',
                name: 'VPN',
                description: { de: 'Zugang', en: 'Access' },
                service_url: 'https://vpn.example.edu',
                doc_url: 'https://docs.example.edu/vpn',
                icon: 'shield',
                categories: ['data'],
                doc_only: false,
              },
              {
                id: 's2',
                name: 'Stud.IP',
                description: { de: 'Lernplattform', en: 'Learning' },
                service_url: 'https://studip.example.edu',
                doc_url: 'https://docs.example.edu/studip',
                icon: 'graduation-cap',
                categories: ['learning'],
                doc_only: false,
              },
            ],
            categories: [
              { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 10 },
              { slug: 'learning', label: { de: 'Lernmanagement', en: 'Learning' }, sort: 20 },
            ],
          })
        }
        if (url.startsWith('/api/favorites')) return jsonResponse({ services: [] })
        if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
        if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
        return jsonResponse({})
      }),
    )
  })

  it('leaving Dienste for Favoriten and back clears an active category filter', async () => {
    setURL('/?cat=data')
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(screen.getByRole('link', { name: /VPN/ })).toBeVisible())
    expect(screen.queryByRole('link', { name: /Stud\.IP/ })).not.toBeInTheDocument()

    const nav = within(screen.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i }))
    await user.click(nav.getByRole('button', { name: 'Favoriten' }))
    await user.click(nav.getByRole('button', { name: 'Dienste' }))

    expect(window.location.search).toBe('?tab=dienste')
    await waitFor(() => expect(screen.getByRole('link', { name: /Stud\.IP/ })).toBeVisible())
    expect(screen.getByRole('heading', { level: 2, name: 'Alle Dienste' })).toBeVisible()
  })

  it('re-clicking the already-active Dienste tab clears an active category filter', async () => {
    setURL('/?cat=data')
    const user = userEvent.setup()
    renderDashboard()

    await waitFor(() => expect(screen.getByRole('link', { name: /VPN/ })).toBeVisible())

    const nav = within(screen.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i }))
    await user.click(nav.getByRole('button', { name: 'Dienste' }))

    expect(window.location.search).toBe('?tab=dienste')
    await waitFor(() => expect(screen.getByRole('link', { name: /Stud\.IP/ })).toBeVisible())
    expect(screen.getByRole('heading', { level: 2, name: 'Alle Dienste' })).toBeVisible()
  })
})

describe('Dashboard clears search on launch from a result (issue #27)', () => {
  let recordClickCalls: unknown[][] = []

  beforeEach(() => {
    recordClickCalls = []
    stubMatchMedia()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.startsWith('/api/catalog')) {
          return jsonResponse({
            services: [
              {
                id: 's1',
                name: 'MyShare',
                description: { de: 'Netzspeicher', en: 'Network storage' },
                service_url: 'https://myshare.example.edu',
                doc_url: 'https://docs.example.edu/myshare',
                icon: 'hard-drive',
                categories: [],
                doc_only: false,
              },
            ],
            categories: [],
          })
        }
        if (url.startsWith('/api/search')) {
          return jsonResponse({
            query: 'MyShare',
            services: [
              {
                id: 's1',
                name: 'MyShare',
                description: { de: 'Netzspeicher', en: 'Network storage' },
                service_url: 'https://myshare.example.edu',
                doc_url: 'https://docs.example.edu/myshare',
                icon: 'hard-drive',
                categories: [],
                doc_only: false,
              },
            ],
          })
        }
        if (url.startsWith('/api/favorites')) return jsonResponse({ services: [] })
        if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
        if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
        if (url.startsWith('/api/events/click')) {
          recordClickCalls.push([url, init?.body])
          return jsonResponse({})
        }
        return jsonResponse({})
      }),
    )
  })

  async function searchAndGetLink() {
    setURL('/?tab=dienste')
    const user = userEvent.setup()
    renderDashboard()

    const search = screen.getByRole('searchbox')
    await user.type(search, 'MyShare')
    await waitFor(() => expect(search).toHaveValue('MyShare'))
    await waitFor(() => expect(screen.getByRole('link', { name: /MyShare/ })).toBeVisible())

    return { user, search, link: screen.getByRole('link', { name: /MyShare/ }) }
  }

  it('a plain left click on the result clears the search', async () => {
    const { user, search, link } = await searchAndGetLink()
    await user.click(link)
    await waitFor(() => expect(search).toHaveValue(''))
    expect(recordClickCalls.length).toBe(1)
  })

  it('a Ctrl-click on the result leaves the search alone', async () => {
    const { user, search, link } = await searchAndGetLink()
    await user.keyboard('{Control>}')
    await user.click(link)
    await user.keyboard('{/Control}')
    await waitFor(() => expect(recordClickCalls.length).toBe(1))
    expect(search).toHaveValue('MyShare')
  })

  it('the documentation link leaves the search alone', async () => {
    const { user, search } = await searchAndGetLink()
    const docLink = screen.getByRole('link', { name: /Doku/ })
    await user.click(docLink)
    await waitFor(() => expect(recordClickCalls.length).toBe(1))
    expect(search).toHaveValue('MyShare')
  })
})


// Review findings 2 and 3: the Beta facet is a real view like the maintenance
// one — it survives a reload — and it must not outlive the pref that produces
// it. Turning beta services off (or deep-linking ?filter=beta without them)
// used to leave a page headed "Beta" with no tiles and no active pill.
describe('the Beta filter (issues #34, review findings 2 and 3)', () => {
  beforeEach(() => {
    stubMatchMedia()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.startsWith('/api/catalog')) {
          return jsonResponse({
            services: [
              {
                id: 's1', name: 'VPN', description: { de: 'Zugang', en: 'Access' },
                service_url: 'https://vpn.example.edu', icon: 'shield',
                categories: ['data'], doc_only: false,
              },
              {
                id: 's2', name: 'Zettelkasten Labor', description: { de: 'Versuch', en: 'Experiment' },
                service_url: 'https://lab.example.edu', icon: 'flask-conical',
                categories: ['data'], doc_only: false, tag: 'beta',
              },
            ],
            categories: [{ slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 10 }],
          })
        }
        if (url.startsWith('/api/favorites')) return jsonResponse({ services: [] })
        if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
        if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
        return jsonResponse({})
      }),
    )
  })

  it('survives a reload: ?filter=beta restores the facet, and it stays in the URL', async () => {
    setURL('/?filter=beta')
    const user = userEvent.setup()
    renderDashboard({ ...ME, show_beta: true })

    await waitFor(() => expect(screen.getByRole('link', { name: /Zettelkasten Labor/ })).toBeVisible())
    // Only the beta service — the facet actually applied, not just parsed.
    expect(screen.queryByRole('link', { name: /VPN/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toBe('?filter=beta')

    // And selecting it from "Alle" puts it back in the URL.
    await user.click(screen.getByRole('button', { name: 'Alle' }))
    expect(window.location.search).toBe('?tab=dienste')
    await user.click(screen.getByRole('button', { name: 'Beta' }))
    expect(window.location.search).toBe('?filter=beta')
  })

  it('drops the facet when the user has beta services off, rather than stranding the view', async () => {
    setURL('/?filter=beta')
    renderDashboard({ ...ME, show_beta: false })

    // Corrected during render: no Beta pill, no "Beta" heading, and the URL
    // no longer claims a filter that cannot apply.
    await waitFor(() => expect(screen.getByRole('link', { name: /VPN/ })).toBeVisible())
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Alle Dienste' })).toBeVisible()
    expect(window.location.search).toBe('?tab=dienste')
  })
})


// The holder's side of the marker: their restricted category is marked as one,
// on the filter pill and on the section heading, so "can I send this link to a
// colleague?" is answerable without opening the admin screens. Non-holders
// never receive the category at all, which the server tests pin.
describe('the restricted marker on the dashboard (issue #121)', () => {
  const held: Me = {
    ...ME,
    visibility: { held: ['it-infra'], entries: [{ slug: 'it-infra', label: { de: 'IT-Infrastruktur', en: 'IT infrastructure' } }] },
  }

  beforeEach(() => {
    stubMatchMedia()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.startsWith('/api/catalog')) {
          return jsonResponse({
            services: [
              {
                id: 's1', name: 'VPN', description: { de: 'Zugang', en: 'Access' },
                service_url: 'https://vpn.example.edu', icon: 'shield',
                categories: ['data'], doc_only: false,
              },
              {
                id: 's2', name: 'Serververwaltung', description: { de: 'Server', en: 'Servers' },
                service_url: 'https://srv.example.edu', icon: 'server',
                categories: ['infra'], doc_only: false,
              },
            ],
            categories: [
              { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 10 },
              // Only ever sent to a holder — the server drops it for everyone else.
              { slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 20, visibility: 'it-infra' },
            ],
          })
        }
        if (url.startsWith('/api/favorites')) return jsonResponse({ services: [] })
        if (url.startsWith('/api/announcements')) return jsonResponse({ announcements: [] })
        if (url.startsWith('/api/usage/frequent')) return jsonResponse({ services: [] })
        return jsonResponse({})
      }),
    )
  })

  it('marks the restricted pill and its section, and says what the lock means', async () => {
    setURL('/?tab=dienste')
    const user = userEvent.setup()
    renderDashboard(held)

    // The pill keeps its name and gains the meaning in its accessible name —
    // no visible label change, so the strip is the width it always was.
    await waitFor(() => expect(screen.getByRole('link', { name: /Serververwaltung/ })).toBeVisible())
    const pill = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.startsWith('Infrastruktur')) as HTMLElement
    expect(pill, 'the restricted category still has its pill').toBeTruthy()
    // The lock's meaning is part of what the button announces — the visible
    // label is unchanged.
    // A regex, not the exact string: jsdom's accname implementation does not
    // insert the separator between element contributions that browsers do, so
    // the exact spacing is pinned by the e2e run instead.
    expect(pill).toHaveAccessibleName(/^Infrastruktur\s*Nur für IT-Infrastruktur sichtbar$/)
    expect(within(pill).getByText('Infrastruktur')).toBeInTheDocument()
    // The public category's pill is untouched.
    expect(screen.getByRole('button', { name: 'Netz & Daten' })).toBeInTheDocument()

    // Selecting it marks the section heading the same way.
    await user.click(pill)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toContain('Infrastruktur')
    expect(within(heading).getByText('Nur für IT-Infrastruktur sichtbar')).toBeInTheDocument()
  })

  it('leaves a public section unmarked', async () => {
    setURL('/?cat=data')
    renderDashboard(held)

    await waitFor(() => expect(screen.getByRole('link', { name: /VPN/ })).toBeVisible())
    // The pill strip still marks the restricted category — this is about the
    // section the user is actually in.
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toContain('Netz & Daten')
    expect(within(heading).queryByText(/Nur für/)).not.toBeInTheDocument()
  })
})
