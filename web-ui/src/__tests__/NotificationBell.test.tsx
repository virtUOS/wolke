import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotificationBell } from '@/components/NotificationBell'
import { api, type Announcement, type Severity } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const ACTIVE_BODY =
  'Heute Abend ab 20 Uhr steht Stud.IP wegen einer umfangreichen Aktualisierung der ' +
  'Lernmanagement-Infrastruktur nicht zur Verfügung. Bitte speichern Sie laufende Arbeiten vorher ab.'

const active: Announcement = {
  id: 'a1', title: { de: 'Wartung Stud.IP' }, body: { de: ACTIVE_BODY },
  severity: 'warning', audience: 'all', dismissible: true, created_at: '2026-06-25T08:00:00Z',
  starts_at: '2026-06-25T18:00:00Z', ends_at: '2026-06-26T04:00:00Z',
}
const past: Announcement = {
  id: 'p1', title: { de: 'VPN-Störung' }, body: { de: 'Behoben. Es gab eine längere Störung im VPN-Dienst, die inzwischen vollständig behoben wurde.' },
  severity: 'info', audience: 'all', dismissible: true, created_at: '2026-06-21T08:00:00Z',
  starts_at: '2026-06-20T08:00:00Z', ends_at: '2026-06-21T08:00:00Z',
}

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

async function openPanel() {
  const user = userEvent.setup()
  render(withClient(<NotificationBell locale="de" />))
  await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
  return user
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

  // Issue #179 §1: the active notice used to be a full Alert with its whole body
  // expanded, which pushed everything else out of the panel. It is now the same
  // compact row as a history entry.
  it('renders an active notice as a row, not an expanded alert', async () => {
    await openPanel()
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    const row = within(panel).getByRole('button', { name: /Wartung Stud\.IP/ })
    expect(row).toHaveAttribute('aria-haspopup', 'dialog')

    // The body is the row's clamped preview, inside the row button — not an
    // expanded Alert body next to it.
    const preview = within(panel).getByText(ACTIVE_BODY)
    expect(preview).toHaveClass('line-clamp-2')
    expect(row).toContainElement(preview)

    // Literally the same row as a history entry.
    const historyRow = await within(panel).findByRole('button', { name: /VPN-Störung/ })
    expect(row.className).toBe(historyRow.className)
  })

  it('opens an active notice in the same dialog as a history row', async () => {
    const user = await openPanel()
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    await user.click(within(panel).getByRole('button', { name: /Wartung Stud\.IP/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Wartung Stud.IP' })
    expect(within(dialog).getByText(ACTIVE_BODY)).toBeInTheDocument()
    expect(within(dialog).getByText(/Gültig vom .* bis .*/)).toBeInTheDocument()
  })

  it.each<[Severity, string]>([
    ['critical', 'text-danger'],
    ['warning', 'text-warning'],
    ['info', 'text-info'],
  ])('tints the %s row icon with its severity token', async (severity, cls) => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [{ ...active, severity }] })
    await openPanel()
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    const row = within(panel).getByRole('button', { name: /Wartung Stud\.IP/ })
    expect(row.querySelector(`.${cls}`)).not.toBeNull()
  })

  // Settled in #179: dismissal is the banner's job. The panel has no dismiss
  // control anywhere — not on a row, not in the notice dialog. The history query
  // already surfaces dismissed notices, so nothing becomes unreachable.
  it('offers no dismiss control anywhere in the panel', async () => {
    const user = await openPanel()
    await screen.findByText('VPN-Störung')
    expect(screen.queryByRole('button', { name: 'Ankündigung schließen' })).not.toBeInTheDocument()

    const panel = screen.getByRole('dialog', { name: 'Mitteilungen' })
    await user.click(within(panel).getByRole('button', { name: /Wartung Stud\.IP/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Wartung Stud.IP' })
    expect(within(dialog).queryByRole('button', { name: 'Ankündigung schließen' })).not.toBeInTheDocument()
  })

  it('labels both groups when both have entries', async () => {
    await openPanel()
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    await screen.findByText('VPN-Störung')
    expect(within(panel).getByRole('heading', { name: 'Aktuell' })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'Verlauf' })).toBeInTheDocument()
  })

  it('renders neither heading nor an empty shell for a group with no entries', async () => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
    await openPanel()
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    await screen.findByText('VPN-Störung')
    expect(within(panel).getByRole('heading', { name: 'Verlauf' })).toBeInTheDocument()
    expect(within(panel).queryByRole('heading', { name: 'Aktuell' })).not.toBeInTheDocument()
  })

  it('has no axe violations with the panel open', async () => {
    const user = userEvent.setup()
    const { container } = render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    await screen.findByText('VPN-Störung')
    await expectNoAxeViolations(container)
  })

  it('opens a history row in a dialog with the full title, body and validity window', async () => {
    const user = userEvent.setup()
    render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    const row = await screen.findByRole('button', { name: /VPN-Störung/ })
    expect(row).toHaveAttribute('aria-haspopup', 'dialog')

    await user.click(row)
    const dialog = await screen.findByRole('dialog', { name: 'VPN-Störung' })
    const dialogScope = within(dialog)
    expect(
      dialogScope.getByText(
        'Behoben. Es gab eine längere Störung im VPN-Dienst, die inzwischen vollständig behoben wurde.',
      ),
    ).toBeInTheDocument()
    expect(dialogScope.getByText(/Gültig vom .* bis .*/)).toBeInTheDocument()
  })

  it('returns focus to the history row when its dialog closes', async () => {
    const user = userEvent.setup()
    render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    const row = await screen.findByRole('button', { name: /VPN-Störung/ })

    await user.click(row)
    await screen.findByRole('dialog', { name: 'VPN-Störung' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'VPN-Störung' })).not.toBeInTheDocument())
    expect(row).toHaveFocus()
  })

  it('has no axe violations with the history dialog open', async () => {
    const user = userEvent.setup()
    const { container } = render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    await user.click(await screen.findByRole('button', { name: /VPN-Störung/ }))
    await screen.findByRole('dialog', { name: 'VPN-Störung' })
    await expectNoAxeViolations(container)
  })
})
