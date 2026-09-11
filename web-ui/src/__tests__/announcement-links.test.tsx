// Issue #168 — the four surfaces that render an announcement body, and the one
// rule that differs between them: three render real anchors, the notification
// history row renders none, because it lives inside a <button> and a nested
// link is invalid HTML and an a11y bug.
//
// The parser itself is covered in rich-text.test.ts; what is asserted here is
// the wiring — which surface links, with which rel/target, and that a denied
// scheme never reaches an href in a real render.

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { NotificationBell } from '@/components/NotificationBell'
import { AnnouncementsAdmin } from '@/components/admin/AnnouncementsAdmin'
import { api, type Announcement, type Role } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const BODY =
  'Zur [Statusseite](https://status.example.edu) oder direkt https://intern.example.edu/plan — ' +
  'Rückfragen an mailto:support@example.edu. Kein Link: [Klick](javascript:alert(1))'

const withLinks: Announcement = {
  id: 'a1',
  title: { de: 'Wartungsfenster', en: 'Maintenance window' },
  body: { de: BODY, en: BODY },
  severity: 'warning',
  audience: 'all',
  dismissible: true,
}

const pastWithLinks: Announcement = {
  ...withLinks,
  id: 'p1',
  title: { de: 'VPN-Störung', en: 'VPN outage' },
  created_at: '2026-06-21T08:00:00Z',
  starts_at: '2026-06-20T08:00:00Z',
  ends_at: '2026-06-21T08:00:00Z',
}

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

/** The three link forms every surface under test carries, plus the denied one. */
function expectTheThreeLinks(scope: HTMLElement) {
  const labelled = within(scope).getByRole('link', { name: 'Statusseite' })
  expect(labelled).toHaveAttribute('href', 'https://status.example.edu')
  expect(labelled).toHaveAttribute('target', '_blank')
  expect(labelled).toHaveAttribute('rel', 'noopener noreferrer')

  const bare = within(scope).getByRole('link', { name: 'https://intern.example.edu/plan' })
  expect(bare).toHaveAttribute('href', 'https://intern.example.edu/plan')
  expect(bare).toHaveAttribute('target', '_blank')
  expect(bare).toHaveAttribute('rel', 'noopener noreferrer')

  // mailto:/tel: open in place — a new tab for a mail client is a dead tab.
  const mail = within(scope).getByRole('link', { name: 'mailto:support@example.edu' })
  expect(mail).toHaveAttribute('href', 'mailto:support@example.edu')
  expect(mail).not.toHaveAttribute('target')

  // The denied scheme is visible as text and is not a link.
  expect(within(scope).getByText(/\[Klick\]\(javascript:alert\(1\)\)/)).toBeInTheDocument()
  for (const a of within(scope).getAllByRole('link')) {
    expect(a.getAttribute('href')?.toLowerCase()).not.toContain('javascript:')
  }
  expect(within(scope).getAllByRole('link')).toHaveLength(3)
}

afterEach(() => vi.restoreAllMocks())

describe('the active banner (AnnouncementBanner)', () => {
  it('renders the body links as anchors', () => {
    render(withClient(<AnnouncementBanner announcements={[withLinks]} locale="de" />))
    expectTheThreeLinks(screen.getByRole('region', { name: 'Ankündigungen' }))
  })

  it('has no axe violations with links in the body', async () => {
    const { container } = render(withClient(<AnnouncementBanner announcements={[withLinks]} locale="de" />))
    await expectNoAxeViolations(container)
  })
})

describe('the notification center (NotificationBell)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [withLinks] })
    vi.spyOn(api, 'announcementHistory').mockResolvedValue({ announcements: [pastWithLinks] })
  })

  async function openPanel() {
    const user = userEvent.setup()
    render(withClient(<NotificationBell locale="de" />))
    await user.click(await screen.findByRole('button', { name: /Mitteilungen/ }))
    return user
  }

  it('renders the active notice in the panel with anchors', async () => {
    await openPanel()
    const panel = await screen.findByRole('dialog', { name: 'Mitteilungen' })
    const active = within(panel).getByText('Wartungsfenster').closest('div[class*="rounded-md"]')!
    expectTheThreeLinks(active as HTMLElement)
  })

  it('renders NO anchor in the history row — it is inside a <button>', async () => {
    await openPanel()
    const row = await screen.findByRole('button', { name: /VPN-Störung/ })
    expect(within(row).queryAllByRole('link')).toHaveLength(0)
    expect(row.querySelectorAll('a')).toHaveLength(0)
    // The row shows the body as text, with the labelled link flattened to its
    // label and the URL of the bare one kept.
    expect(row.textContent).toContain('Zur Statusseite oder direkt https://intern.example.edu/plan')
    expect(row.textContent).not.toContain('](https://status.example.edu)')
  })

  it('renders the history dialog body with anchors', async () => {
    const user = await openPanel()
    await user.click(await screen.findByRole('button', { name: /VPN-Störung/ }))
    const dialog = await screen.findByRole('dialog', { name: 'VPN-Störung' })
    expectTheThreeLinks(dialog)
  })

  // The panel stays mounted under the layered dialog, and its global Tab trap
  // used to pull focus straight back out — so the dialog's links (and its own
  // close button) were unreachable by keyboard. Only the topmost overlay traps.
  it('keeps Tab inside the history dialog, reaching its links', async () => {
    const user = await openPanel()
    await user.click(await screen.findByRole('button', { name: /VPN-Störung/ }))
    const dialog = await screen.findByRole('dialog', { name: 'VPN-Störung' })

    const reached: string[] = []
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
      if (document.activeElement?.tagName === 'A') reached.push(document.activeElement.textContent ?? '')
    }
    expect(reached).toContain('Statusseite')
  })

  it('has no axe violations with the history dialog open', async () => {
    const user = await openPanel()
    await user.click(await screen.findByRole('button', { name: /VPN-Störung/ }))
    await screen.findByRole('dialog', { name: 'VPN-Störung' })
    await expectNoAxeViolations(document.body, ['region'])
  })
})

describe('the admin editor (AnnouncementsAdmin)', () => {
  const roles: Role[] = [{ slug: 'staff', label: { de: 'Mitarbeitende', en: 'Staff' } }]

  beforeEach(() => {
    vi.spyOn(api, 'roles').mockResolvedValue(roles)
    vi.spyOn(api, 'adminAnnouncements').mockResolvedValue({ announcements: [] })
  })

  async function openForm() {
    const user = userEvent.setup()
    render(withClient(<AnnouncementsAdmin locale="de" />))
    // The create button stays disabled until /api/roles resolves.
    const create = await screen.findByRole('button', { name: 'Ankündigung anlegen' })
    await waitFor(() => expect(create).toBeEnabled())
    await user.click(create)
    return user
  }

  it('names the two link forms in a hint under each body field', async () => {
    await openForm()
    const hints = await screen.findAllByText(/\[Text\]\(https:\/\/…\)/)
    expect(hints).toHaveLength(2)
  })

  it('previews the parsed body as the author types', async () => {
    const user = await openForm()
    const de = screen.getByLabelText(/^Text \(de\)/)
    await user.click(de)
    await user.paste('Zur [Statusseite](https://status.example.edu) wechseln')

    const preview = await screen.findByRole('group', { name: 'Vorschau (de)' })
    const link = within(preview).getByRole('link', { name: 'Statusseite' })
    expect(link).toHaveAttribute('href', 'https://status.example.edu')
  })

  it('does not preview a denied scheme as a link', async () => {
    const user = await openForm()
    const de = screen.getByLabelText(/^Text \(de\)/)
    await user.click(de)
    await user.paste('[Klick](javascript:alert(1))')

    const preview = await screen.findByRole('group', { name: 'Vorschau (de)' })
    expect(within(preview).queryAllByRole('link')).toHaveLength(0)
    expect(preview.textContent).toContain('[Klick](javascript:alert(1))')
  })

  it('shows no preview box while the body is empty', async () => {
    await openForm()
    expect(screen.queryByRole('group', { name: 'Vorschau (de)' })).not.toBeInTheDocument()
  })
})
