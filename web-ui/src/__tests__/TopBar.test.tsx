import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TopBar, type Tab } from '@/components/TopBar'
import { api } from '@/lib/api'
import type { Branding } from '@/lib/branding'

const branding = {
  product_name: 'wolke',
  org_name: 'Uni',
  logo_light: '/l.svg',
  logo_dark: '/d.svg',
  favicon: '/f.svg',
  default_locale: 'de',
  imprint_url: '',
  privacy_url: '',
  feedback_url: '',
  bot_url: '',
  help_url: '',
  assistant_widget_url: '',
  assistant_bot_id: '',
  theme: { light: {}, dark: {} },
} as Branding

// TopBar mounts the NotificationBell, which reads server state via TanStack
// Query, so renders need a QueryClient and a stubbed announcements call.
function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function renderTopBar(
  tab: Tab | null,
  onTab: (t: Tab) => void = () => {},
  opts: { isMobile?: boolean; branding?: Branding } = {},
) {
  return render(
    withClient(
      <TopBar
        branding={opts.branding ?? branding}
        locale="de"
        currentLocalePref="auto"
        tab={tab}
        onTab={onTab}
        isDark={false}
        onToggleTheme={() => {}}
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

describe('TopBar section tabs', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('marks the active tab with aria-current', () => {
    renderTopBar('favoriten')
    expect(screen.getByRole('button', { name: 'Favoriten' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Dienste' })).not.toHaveAttribute('aria-current')
  })

  it('highlights no tab in search mode (tab = null)', () => {
    renderTopBar(null)
    expect(screen.getByRole('button', { name: 'Favoriten' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Dienste' })).not.toHaveAttribute('aria-current')
  })

  it('still reports tab clicks while in search mode', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderTopBar(null, onTab)
    await user.click(screen.getByRole('button', { name: 'Dienste' }))
    expect(onTab).toHaveBeenCalledWith('dienste')
    await user.click(screen.getByRole('button', { name: 'Favoriten' }))
    expect(onTab).toHaveBeenCalledWith('favoriten')
  })

  it('reports tab clicks from the phone layout too', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    renderTopBar('favoriten', onTab, { isMobile: true })
    await user.click(screen.getByRole('button', { name: 'Dienste' }))
    expect(onTab).toHaveBeenCalledWith('dienste')
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
    renderTopBar('favoriten', () => {}, { branding: linked })
    expect(screen.getByRole('banner').querySelector('a[href="https://bot.example.edu"]')).not.toBeNull()
    expect(screen.getByRole('banner').querySelector('a[href="https://help.example.edu"]')).not.toBeNull()
  })

  it('moves them into the account menu on a phone', async () => {
    const user = userEvent.setup()
    renderTopBar('favoriten', () => {}, { branding: linked, isMobile: true })

    // Not in the bar itself…
    expect(screen.queryByRole('link', { name: 'Chatbot' })).toBeNull()

    // …but present once the account menu is open.
    await user.click(screen.getByRole('button', { name: /Konto-Menü/ }))
    const menu = screen.getByRole('dialog')
    expect(menu.querySelector('a[href="https://bot.example.edu"]')).not.toBeNull()
    expect(menu.querySelector('a[href="https://help.example.edu"]')).not.toBeNull()
  })
})
