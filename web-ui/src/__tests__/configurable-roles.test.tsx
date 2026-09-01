import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementsAdmin } from '@/components/admin/AnnouncementsAdmin'
import { RoleDefaultsAdmin } from '@/components/admin/RoleDefaultsAdmin'
import { api, type Role } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

// The launch deployment's role set: an IdM that only tells students from
// employees. Nothing in the UI may assume more (or other) roles.
const twoRoles: Role[] = [
  { slug: 'staff', label: { de: 'Mitarbeitende', en: 'Staff' } },
  { slug: 'student', label: { de: 'Studierende', en: 'Students' } },
]

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

  it('flags an announcement addressed to a role the deployment no longer configures', async () => {
    stubApi(twoRoles)
    vi.spyOn(api, 'adminAnnouncements').mockResolvedValue({
      announcements: [
        {
          id: 'a1',
          title: { de: 'Alte Mitteilung' },
          body: { de: 'Text.' },
          severity: 'info',
          audience: 'teacher',
          audience_unknown: true,
          dismissible: true,
        },
      ],
    })
    render(withClient(<AnnouncementsAdmin locale="de" />))

    expect(await screen.findByText('Alte Mitteilung')).toBeInTheDocument()
    expect(screen.getByText(/nicht konfiguriert/i)).toBeInTheDocument()
  })
})
