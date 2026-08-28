import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import type { Me } from '@/lib/api'
import { Dashboard } from '@/components/Dashboard'

// Regression coverage for issue #31 at the Dashboard level (view-history.test.tsx
// covers useViewHistory itself, but not the onTab handler wired to it here):
// switching tabs must reset both the query text and any active category filter,
// whether the target tab was already active or not (873f054, issue #29).

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
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function setURL(path: string) {
  window.history.replaceState(null, '', path)
}

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Dashboard branding={BRANDING} me={ME} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // matchMedia is used for the desktop/mobile breakpoint and prefers-color-scheme.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'), // desktop layout, so the category pills render
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia

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

afterEach(() => {
  setURL('/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Dashboard tab navigation resets the filter (issue #31)', () => {
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
