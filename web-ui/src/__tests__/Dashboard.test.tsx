import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Branding } from '@/lib/branding'
import type { Me } from '@/lib/api'
import { Dashboard } from '@/components/Dashboard'

// Issue #27: launching a service from an open search, by a plain left click,
// clears the search — but a deliberate new-tab gesture (Ctrl/Cmd/Shift-click)
// or the doc link must leave it alone. Click tracking (recordClick) fires
// unconditionally either way; these tests cover the query-clearing decision
// made in Dashboard's `actions.onLaunch`, which Tile.test.tsx doesn't reach.

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

let recordClickCalls: unknown[][] = []

beforeEach(() => {
  recordClickCalls = []
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'), // desktop layout
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia

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

afterEach(() => {
  setURL('/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Dashboard clears search on launch from a result (issue #27)', () => {
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
