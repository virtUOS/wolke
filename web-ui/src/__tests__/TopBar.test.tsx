import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TopBar } from '@/components/TopBar'
import { api, type Me } from '@/lib/api'
import type { Branding } from '@/lib/branding'
import { BRANDING } from '@/test/branding'

const branding: Branding = {
  ...BRANDING,
  // TopBar renders the mark and the wordmark, so this suite wants a real logo
  // pair rather than the shared fixture's empty defaults.
  org_name: 'Uni',
  logo_light: '/l.svg',
  logo_dark: '/d.svg',
  favicon: '/f.svg',
}

// TopBar mounts the NotificationBell, which reads server state via TanStack
// Query, so renders need a QueryClient and a stubbed announcements call.
function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function renderTopBar(
  opts: { isMobile?: boolean; branding?: Branding; theme?: Me['theme']; onSetTheme?: (next: Me['theme']) => void } = {},
) {
  return render(
    withClient(
      <TopBar
        branding={opts.branding ?? branding}
        locale="de"
        currentLocalePref="auto"
        theme={opts.theme ?? 'system'}
        onSetTheme={opts.onSetTheme ?? (() => {})}
        onSetLocale={() => {}}
        userInitials="TB"
        userName="Tim B"
        isAdmin={false}
        onAdmin={() => {}}
        onLogout={() => {}}
        isMobile={opts.isMobile ?? false}
      />,
    ),
  )
}

// The Favoriten/Dienste switch left the bar in issue #170 — it is an underline
// tab row above the list now. Its behaviour (aria-current, click reporting, the
// phone layout) is covered where it lives: launcher-tabs.test.tsx.
describe('TopBar after the view switch moved out (issue #170)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('carries no view switch, at either width', () => {
    for (const isMobile of [false, true]) {
      const { unmount } = renderTopBar({ isMobile })
      const bar = screen.getByRole('banner')
      expect(within(bar).queryByRole('button', { name: /^Favoriten/ })).toBeNull()
      expect(within(bar).queryByRole('button', { name: /^(Alle )?Dienste/ })).toBeNull()
      expect(within(bar).queryByRole('navigation')).toBeNull()
      unmount()
    }
  })
})

// The 324px row cannot hold the logo, the tabs and four actions, which is what
// pushed the whole document into horizontal scroll (issue #23). On a phone the
// quick links move into the account menu instead of being dropped.
describe('TopBar quick links', () => {
  const linked = { ...branding, bot_url: 'https://bot.example.edu', help_url: 'https://help.example.edu' }

  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows them in the bar on a desktop', () => {
    renderTopBar({ branding: linked })
    expect(screen.getByRole('banner').querySelector('a[href="https://bot.example.edu"]')).not.toBeNull()
    expect(screen.getByRole('banner').querySelector('a[href="https://help.example.edu"]')).not.toBeNull()
  })

  // branding.news_url reaches the notification panel through the bell (#179).
  it('passes news_url through to the notification panel', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'announcementHistory').mockResolvedValue({ announcements: [] })
    renderTopBar({ branding: { ...linked, news_url: 'https://news.example.edu' } })

    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    expect(within(panel).getByRole('link', { name: 'Alle Neuigkeiten' })).toHaveAttribute(
      'href',
      'https://news.example.edu',
    )
  })

  it('moves them into the account menu on a phone', async () => {
    const user = userEvent.setup()
    renderTopBar({ branding: linked, isMobile: true })

    // Not in the bar itself…
    expect(screen.queryByRole('link', { name: 'Chatbot' })).toBeNull()

    // …but present once the account menu is open.
    await user.click(screen.getByRole('button', { name: /Konto-Menü/ }))
    const menu = screen.getByRole('dialog')
    expect(menu.querySelector('a[href="https://bot.example.edu"]')).not.toBeNull()
    expect(menu.querySelector('a[href="https://help.example.edu"]')).not.toBeNull()
  })
})

// Issue #28: the theme control in the account menu must be a three-way group
// (Automatisch | Hell | Dunkel) that mirrors the language switcher right below
// it, not a single toggle button.
describe('TopBar theme group', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  async function openMenu() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Konto-Menü/ }))
    return { user, group: screen.getByRole('group', { name: 'Farbschema' }) }
  }

  it('renders three options and marks the active one aria-pressed', async () => {
    renderTopBar({ theme: 'light' })
    const { group } = await openMenu()
    const g = within(group)
    expect(g.getByRole('button', { name: 'Automatisch' })).toHaveAttribute('aria-pressed', 'false')
    expect(g.getByRole('button', { name: 'Hell' })).toHaveAttribute('aria-pressed', 'true')
    expect(g.getByRole('button', { name: 'Dunkel' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('each option calls onSetTheme with system/light/dark', async () => {
    const onSetTheme = vi.fn()
    renderTopBar({ theme: 'system', onSetTheme })
    const { user, group } = await openMenu()
    const g = within(group)

    await user.click(g.getByRole('button', { name: 'Hell' }))
    expect(onSetTheme).toHaveBeenCalledWith('light')
    await user.click(g.getByRole('button', { name: 'Dunkel' }))
    expect(onSetTheme).toHaveBeenCalledWith('dark')
    await user.click(g.getByRole('button', { name: 'Automatisch' }))
    expect(onSetTheme).toHaveBeenCalledWith('system')
  })
})
