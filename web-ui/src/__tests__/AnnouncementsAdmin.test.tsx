import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementsAdmin } from '@/components/admin/AnnouncementsAdmin'
import { api, type Announcement, type Role } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const roles: Role[] = [
  { slug: 'staff', label: { de: 'Mitarbeitende', en: 'Staff' } },
  { slug: 'student', label: { de: 'Studierende', en: 'Students' } },
]

// Newest-first, as AdminList returns them. Only the newest can be genuinely
// live — the retire-on-create invariant (internal/service/announce.go) means
// an older row's own window is always in the past by the time a newer one
// exists.
const activeNow: Announcement = {
  id: 'a-active',
  title: { de: 'Wartungsfenster heute', en: 'Maintenance window today' },
  body: { de: 'Text.', en: 'Text.' },
  severity: 'warning',
  audience: 'all',
  dismissible: true,
  starts_at: '2020-01-01T00:00:00Z',
}
const expiredNewest: Announcement = {
  id: 'a-expired',
  title: { de: 'Abgelaufene Ankündigung', en: 'Expired announcement' },
  body: { de: 'Text.', en: 'Text.' },
  severity: 'info',
  audience: 'all',
  dismissible: true,
  ends_at: '2020-01-02T00:00:00Z',
}
const retired: Announcement = {
  id: 'a-retired',
  title: { de: 'Alte Ankündigung', en: 'Old announcement' },
  body: { de: 'Text.', en: 'Text.' },
  severity: 'critical',
  audience: 'staff',
  dismissible: false,
  ends_at: '2019-12-01T00:00:00Z',
}

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function stubApi(announcements: Announcement[]) {
  vi.spyOn(api, 'roles').mockResolvedValue(roles)
  vi.spyOn(api, 'adminAnnouncements').mockResolvedValue({ announcements })
}

afterEach(() => vi.restoreAllMocks())

describe('AnnouncementsAdmin — full list (issue #115)', () => {
  it('renders every retained announcement, newest first, with per-row status', async () => {
    stubApi([activeNow, retired])
    render(withClient(<AnnouncementsAdmin locale="de" />))

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Wartungsfenster heute')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Aktiv')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Alte Ankündigung')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Abgelöst')).toBeInTheDocument()
  })

  it('marks the newest row expired, not active, once its own window has passed', async () => {
    stubApi([expiredNewest])
    render(withClient(<AnnouncementsAdmin locale="de" />))

    await screen.findByText('Abgelaufene Ankündigung')
    expect(screen.getByText('Abgelaufen')).toBeInTheDocument()
    expect(screen.queryByText('Aktiv')).not.toBeInTheDocument()
  })

  it('edits a retired announcement, not just the current one', async () => {
    stubApi([activeNow, retired])
    const update = vi.spyOn(api, 'updateAnnouncement').mockResolvedValue(retired)
    const user = userEvent.setup()
    render(withClient(<AnnouncementsAdmin locale="de" />))

    const rows = await screen.findAllByRole('listitem')
    await user.click(within(rows[1]).getByRole('button', { name: 'Bearbeiten' }))
    expect(await screen.findByDisplayValue('Alte Ankündigung')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][0]).toBe('a-retired')
  })

  it('erases a specific row (not necessarily the current one), with confirm text naming it', async () => {
    stubApi([activeNow, retired])
    const del = vi.spyOn(api, 'deleteAnnouncement').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(withClient(<AnnouncementsAdmin locale="de" />))

    const rows = await screen.findAllByRole('listitem')
    await user.click(within(rows[1]).getByRole('button', { name: 'Löschen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Ankündigung entfernen?' })
    expect(within(dialog).getByText(/Alte Ankündigung/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Verlauf aller Nutzer/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('a-retired'))
    // The other row is untouched.
    expect(screen.getByText('Wartungsfenster heute')).toBeInTheDocument()
  })

  it('has no axe violations with a multi-row list', async () => {
    stubApi([activeNow, retired])
    const { container } = render(withClient(<AnnouncementsAdmin locale="de" />))
    await screen.findAllByRole('listitem')
    await expectNoAxeViolations(container)
  })
})
