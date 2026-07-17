import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotificationBell } from '@/components/NotificationBell'
import { api, type Announcement } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const active: Announcement = {
  id: 'a1', title: { de: 'Wartung Stud.IP' }, body: { de: 'Heute Abend.' },
  severity: 'warning', audience: 'all', dismissible: true,
}
const past: Announcement = {
  id: 'p1', title: { de: 'VPN-Störung' }, body: { de: 'Behoben.' },
  severity: 'info', audience: 'all', dismissible: true, created_at: '2026-06-21T08:00:00Z',
}

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [active] })
    vi.spyOn(api, 'announcementHistory').mockResolvedValue({ announcements: [past] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('labels the bell with the active, undismissed count', async () => {
    render(withClient(<NotificationBell locale="de" />))
    expect(await screen.findByRole('button', { name: 'Mitteilungen (1 neu)' })).toBeInTheDocument()
  })

  it('opens a panel showing active notices and lazily-loaded history', async () => {
    const user = userEvent.setup()
    render(withClient(<NotificationBell locale="de" />))
    // History is not fetched until the panel opens.
    expect(api.announcementHistory).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    expect(panel).toBeInTheDocument()
    expect(screen.getByText('Wartung Stud.IP')).toBeInTheDocument()
    // The history section and its item appear once the lazy query resolves.
    expect(await screen.findByText('VPN-Störung')).toBeInTheDocument()
    expect(api.announcementHistory).toHaveBeenCalled()
  })

  it('dismisses an active notice from the panel', async () => {
    const spy = vi.spyOn(api, 'dismissAnnouncement').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    await user.click(await screen.findByRole('button', { name: 'Ankündigung schließen' }))
    expect(spy).toHaveBeenCalledWith('a1')
  })

  it('has no axe violations with the panel open', async () => {
    const user = userEvent.setup()
    const { container } = render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    await screen.findByText('VPN-Störung')
    await expectNoAxeViolations(container)
  })
})
