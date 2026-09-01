import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementsAdmin } from '@/components/admin/AnnouncementsAdmin'
import { RoleDefaultsAdmin } from '@/components/admin/RoleDefaultsAdmin'
import { api, type Announcement, type Role, type Service } from '@/lib/api'
import { t } from '@/lib/i18n'
import { expectNoAxeViolations } from '@/test/axe'

// The launch deployment's role set: an IdM that only tells students from
// employees. Nothing in the UI may assume more (or other) roles.
const twoRoles: Role[] = [
  { slug: 'staff', label: { de: 'Mitarbeitende', en: 'Staff' } },
  { slug: 'student', label: { de: 'Studierende', en: 'Students' } },
]

// An announcement addressed to a role this deployment no longer configures.
const staleAnnouncement: Announcement = {
  id: 'a1',
  title: { de: 'Alte Mitteilung', en: 'Old notice' },
  body: { de: 'Text.', en: 'Text.' },
  severity: 'info',
  audience: 'teacher',
  audience_unknown: true,
  dismissible: true,
}

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function stubApi(roles: Role[]) {
  vi.spyOn(api, 'roles').mockResolvedValue(roles)
  vi.spyOn(api, 'catalog').mockResolvedValue({ services: [], categories: [] })
  vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: [] })
  vi.spyOn(api, 'adminAnnouncements').mockResolvedValue({ announcements: [] })
}

const s = t('de')

afterEach(() => vi.restoreAllMocks())

describe('RoleDefaultsAdmin', () => {
  it('renders one tab per configured role, labelled in the active locale', async () => {
    stubApi(twoRoles)
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    await screen.findByRole('button', { name: 'Mitarbeitende' })
    expect(screen.getByRole('button', { name: 'Studierende' })).toBeInTheDocument()
    // A role from another deployment's set must not appear.
    expect(screen.queryByRole('button', { name: /Lehrende/ })).not.toBeInTheDocument()
  })

  it('starts on the first role in precedence order and switches on click', async () => {
    stubApi(twoRoles)
    const spy = vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: [] })
    const user = userEvent.setup()
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('staff'))
    await user.click(screen.getByRole('button', { name: 'Studierende' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('student'))
  })

  it('scales to a six-role deployment', async () => {
    const many: Role[] = ['staff', 'student', 'alumni', 'guest', 'faculty', 'external'].map((slug) => ({
      slug,
      label: { de: slug, en: slug },
    }))
    stubApi(many)
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    for (const role of many) {
      expect(await screen.findByRole('button', { name: role.slug })).toBeInTheDocument()
    }
  })

  it('reconciles the selected role when the configured set changes under it', async () => {
    stubApi(twoRoles)
    const spy = vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: [] })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc}>
        <RoleDefaultsAdmin locale="de" />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Studierende' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('student'))

    // The deployment drops `student` and the roles query refetches: the editor
    // must fall back to a role that still exists rather than editing (and
    // saving) one that is gone.
    vi.spyOn(api, 'roles').mockResolvedValue([twoRoles[0]])
    await act(() => qc.refetchQueries({ queryKey: ['roles'] }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mitarbeitende' })).toHaveAttribute('aria-current', 'true'),
    )
    expect(screen.queryByRole('button', { name: 'Studierende' })).not.toBeInTheDocument()
  })

  // The "add" picker re-offers whatever is not in the list, so a service name
  // can be on screen as an <option> while absent from the list itself. Every
  // assertion about the list is scoped to the list.
  const rows = () => within(screen.getByRole('list')).queryAllByRole('listitem').map((li) => li.textContent ?? '')

  // The defaults fetch is not instant and the picker is usable while it is in
  // flight. It used to `setOrdered(response)` unconditionally — and to re-run on
  // every catalog refetch — so an add made in that window vanished when the
  // response landed. Local edits now sit on top of the server's list.
  it('keeps an add made while the defaults fetch is still in flight', async () => {
    const services: Service[] = [
      { id: 'svc-a', name: 'Stud.IP', description: {}, icon: 'graduation-cap', categories: [], doc_only: false },
      { id: 'svc-b', name: 'MyShare', description: {}, icon: 'hard-drive', categories: [], doc_only: false },
    ]
    stubApi(twoRoles)
    vi.spyOn(api, 'catalog').mockResolvedValue({ services, categories: [] })
    let resolveDefaults: (r: { service_ids: string[] }) => void = () => {}
    vi.spyOn(api, 'roleDefaults').mockReturnValue(
      new Promise((resolve) => {
        resolveDefaults = resolve
      }),
    )
    const user = userEvent.setup()
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    // Add MyShare before the role's saved defaults have arrived.
    const picker = await screen.findByLabelText(s.admin.add)
    await user.selectOptions(picker, 'svc-b')
    expect(rows().join('|')).toMatch(/MyShare/)

    // The response arrives with Stud.IP as the role's saved default.
    await act(async () => {
      resolveDefaults({ service_ids: ['svc-a'] })
    })

    // Both are listed: the admin's add survived, and the saved default was not
    // dropped from the list they are about to save.
    await waitFor(() => expect(rows().join('|')).toMatch(/Stud\.IP/))
    expect(rows().join('|'), 'the in-flight add must survive the response').toMatch(/MyShare/)
  })

  // The same fetch was keyed on catalog.data, so a catalog that actually changed
  // (an admin adds a service; the catalog query invalidates) re-ran it and
  // replaced the list wholesale. It must leave a local edit alone.
  it('survives a changed catalog without re-fetching or replacing the list', async () => {
    const services: Service[] = [
      { id: 'svc-a', name: 'Stud.IP', description: {}, icon: 'graduation-cap', categories: [], doc_only: false },
      { id: 'svc-b', name: 'MyShare', description: {}, icon: 'hard-drive', categories: [], doc_only: false },
    ]
    stubApi(twoRoles)
    vi.spyOn(api, 'catalog').mockResolvedValue({ services, categories: [] })
    const defaults = vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: ['svc-a'] })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc}>
        <RoleDefaultsAdmin locale="de" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(rows().join('|')).toMatch(/Stud\.IP/))
    await user.selectOptions(await screen.findByLabelText(s.admin.add), 'svc-b')
    const callsBefore = defaults.mock.calls.length

    // A genuinely different catalog: identical data would be structurally
    // shared by TanStack Query and never change the reference the old effect
    // keyed on, so this is what the defect actually needed.
    vi.spyOn(api, 'catalog').mockResolvedValue({
      services: [...services, { id: 'svc-c', name: 'VPN', description: {}, icon: 'shield', categories: [], doc_only: false }],
      categories: [],
    })
    await act(() => qc.refetchQueries({ queryKey: ['catalog'] }))

    // Wait for the new catalog to actually reach the component — it arrives a
    // render later, which is exactly when the old effect re-fired.
    await screen.findByRole('option', { name: 'VPN' })

    expect(defaults.mock.calls.length, 'a changed catalog must not re-fetch the defaults').toBe(callsBefore)
    expect(rows().join('|'), 'a changed catalog must not replace the list').toMatch(/MyShare/)
    expect(rows().join('|')).toMatch(/Stud\.IP/)
  })

  it('has no axe violations', async () => {
    stubApi(twoRoles)
    const { container } = render(withClient(<RoleDefaultsAdmin locale="de" />))
    await screen.findByRole('button', { name: 'Mitarbeitende' })
    await expectNoAxeViolations(container)
  })
})

describe('AnnouncementsAdmin audience picker', () => {
  it('offers "all" plus the configured roles, and nothing else', async () => {
    stubApi(twoRoles)
    const user = userEvent.setup()
    render(withClient(<AnnouncementsAdmin locale="de" />))

    await user.click(screen.getByRole('button', { name: 'Ankündigung anlegen' }))
    const select = await screen.findByLabelText('Zielgruppe')
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['all', 'staff', 'student'])
    expect(within(select).getByRole('option', { name: 'Mitarbeitende' })).toBeInTheDocument()
  })

  it('waits for the configured roles before offering the form', async () => {
    stubApi(twoRoles)
    // A roles query that never resolves: publishing before it does would offer
    // an audience picker missing every role.
    vi.spyOn(api, 'roles').mockReturnValue(new Promise(() => {}))
    render(withClient(<AnnouncementsAdmin locale="de" />))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ankündigung anlegen' })).toBeDisabled())
  })

  it('keeps a stale audience editable, as a visible option', async () => {
    stubApi(twoRoles)
    vi.spyOn(api, 'adminAnnouncements').mockResolvedValue({ announcements: [staleAnnouncement] })
    const update = vi.spyOn(api, 'updateAnnouncement').mockResolvedValue(staleAnnouncement)
    const user = userEvent.setup()
    render(withClient(<AnnouncementsAdmin locale="de" />))

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    const audience = await screen.findByLabelText('Zielgruppe')
    // The stale audience is selected and present as an option — without it the
    // select would silently reassign the announcement on save.
    expect((audience as HTMLSelectElement).value).toBe('teacher')
    expect(within(audience).getByRole('option', { name: /teacher/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    const [, input] = update.mock.calls[0]
    expect(input.audience).toBe('teacher')
    // The flag is server-computed read-only state, never part of a write.
    expect(input).not.toHaveProperty('audience_unknown')
  })

  it('flags an announcement addressed to a role the deployment no longer configures', async () => {
    stubApi(twoRoles)
    vi.spyOn(api, 'adminAnnouncements').mockResolvedValue({ announcements: [staleAnnouncement] })
    render(withClient(<AnnouncementsAdmin locale="de" />))

    expect(await screen.findByText('Alte Mitteilung')).toBeInTheDocument()
    expect(screen.getByText(s.admin.audienceUnknown)).toBeInTheDocument()
  })
})
