import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Tile } from '@/components/Tile'
import { TopBar } from '@/components/TopBar'
import { CategoriesAdmin } from '@/components/admin/CategoriesAdmin'
import { RoleDefaultsAdmin } from '@/components/admin/RoleDefaultsAdmin'
import { ServiceForm } from '@/components/admin/ServiceForm'
import { api, type AdminService, type Category, type Me, type Role, type Service, type VisibilityEntry } from '@/lib/api'
import type { Branding } from '@/lib/branding'
import { expectNoAxeViolations } from '@/test/axe'

// Service visibility v2 (docs/specs/service-visibility.md): the built-in beta
// switch behind its warning dialog, the category editor's visibility selector,
// the service form's derived hint (never a control), and the public-only
// role-defaults picker reading unnarrowed admin data.

const itInfra: VisibilityEntry = {
  slug: 'it-infra',
  label: { de: 'IT-Infrastruktur', en: 'IT infrastructure' },
}

const categories: Category[] = [
  { slug: 'labs', label: { de: 'Labore', en: 'Labs' }, sort: 10 },
  { slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 20, visibility: 'it-infra' },
]

const betaSvc: Service = {
  id: 'x1',
  name: 'Zettelkasten Labor',
  description: { de: 'Ein Versuch.', en: 'An experiment.' },
  service_url: 'https://lab.example.edu',
  icon: 'flask-conical',
  categories: ['labs'],
  doc_only: false,
  tag: 'beta',
}
const publicSvc: Service = { ...betaSvc, id: 'p1', name: 'VPN', tag: undefined }

const adminService = (over: Partial<AdminService>): AdminService => ({
  id: 'p1', name: 'VPN', description: { de: 'x', en: 'x' }, service_url: 'https://v.example.edu',
  icon: 'server', is_active: true, categories: ['labs'], keywords: [], ...over,
})

const branding = {
  product_name: 'wolke', org_name: 'Uni', logo_light: '/l.svg', logo_dark: '/d.svg', favicon: '/f.svg',
  default_locale: 'de', imprint_url: '', privacy_url: '', feedback_url: '', bot_url: '', help_url: '',
  assistant_widget_url: '', assistant_bot_id: '', theme: { light: {}, dark: {} },
} as Branding

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u1', display_name: 'Tim B', primary_role: 'staff', is_admin: true,
  view_mode: 'auto', theme: 'system', locale: 'auto', favorites_order: 'usage',
  favorites_separate_tab: false, show_beta: false,
  visibility: { held: [], entries: [itInfra] }, ...over,
})

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

// v1 badged restricted services with a second, configured label next to the
// tag. v2 has one badge, the one the tag already rendered.
describe('Tile badges', () => {
  it('badges a beta service with its tag and nothing else', () => {
    render(<Tile service={betaSvc} categories={categories} locale="de" />)
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Zettelkasten Labor öffnen \(Beta\)/ })).toBeInTheDocument()
  })

  it('renders no status badge for a plain service', () => {
    render(<Tile service={publicSvc} categories={categories} locale="de" />)
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'VPN öffnen (öffnet in neuem Tab)' })).toBeInTheDocument()
  })

  it('renders the list layout badge too, without axe violations', async () => {
    const { container } = render(<Tile service={betaSvc} categories={categories} locale="de" layout="list" />)
    expect(screen.getByText('Beta')).toBeInTheDocument()
    await expectNoAxeViolations(container, ['region'])
  })
})

describe('Account menu beta switch', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
  })

  function renderMenu(showBeta: boolean, onSet = vi.fn()) {
    render(
      withClient(
        <TopBar
          branding={branding}
          locale="de"
          currentLocalePref="auto"
          tab="dienste"
          onTab={() => {}}
          theme="system"
          onSetTheme={() => {}}
          onSetLocale={() => {}}
          userInitials="TB"
          userName="Tim B"
          isAdmin={false}
          onAdmin={() => {}}
          onLogout={() => {}}
          isMobile={false}
          showBeta={showBeta}
          onSetShowBeta={onSet}
        />,
      ),
    )
    return onSet
  }

  // Built in, not configured: the switch is there on every deployment.
  it('renders one switch, off by default', async () => {
    const user = userEvent.setup()
    renderMenu(false)
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    const menu = screen.getByRole('dialog', { name: 'Konto' })
    expect(within(menu).getByRole('switch', { name: 'Beta-Dienste anzeigen' })).toHaveAttribute('aria-checked', 'false')
    await expectNoAxeViolations(menu, ['region'])
  })

  it('enabling asks for confirmation with the built-in warning, then persists', async () => {
    const user = userEvent.setup()
    const onSet = renderMenu(false)
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    await user.click(screen.getByRole('switch', { name: 'Beta-Dienste anzeigen' }))

    // Nothing written yet: the warning comes first.
    expect(onSet).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Beta-Dienste anzeigen?' })
    expect(within(dialog).getByText(/ohne Vorankündigung verschwinden/)).toBeInTheDocument()
    // The menu stepped aside so the two overlays never fight over focus.
    expect(screen.queryByRole('dialog', { name: 'Konto' })).not.toBeInTheDocument()
    await expectNoAxeViolations(dialog, ['region'])

    await user.click(within(dialog).getByRole('button', { name: 'Anzeigen' }))
    expect(onSet).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Focus returns to the avatar trigger, not to <body>.
    expect(screen.getByRole('button', { name: 'Konto-Menü öffnen' })).toHaveFocus()
  })

  it('cancelling the warning writes nothing', async () => {
    const user = userEvent.setup()
    const onSet = renderMenu(false)
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    await user.click(screen.getByRole('switch', { name: 'Beta-Dienste anzeigen' }))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onSet).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('disabling is immediate — nothing is lost, so no dialog', async () => {
    const user = userEvent.setup()
    const onSet = renderMenu(true)
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    const sw = screen.getByRole('switch', { name: 'Beta-Dienste anzeigen' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    expect(onSet).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog', { name: /anzeigen\?/ })).not.toBeInTheDocument()
  })
})

describe('Category editor visibility selector', () => {
  beforeEach(() => {
    vi.spyOn(api, 'me').mockResolvedValue(me())
  })

  it('is absent when the deployment configures no groups', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(me({ visibility: { held: [], entries: [] } }))
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))
    await waitFor(() => expect(screen.getByText('Labore')).toBeInTheDocument())
    expect(screen.queryByRole('group', { name: 'Sichtbarkeit' })).not.toBeInTheDocument()
  })

  it('offers Öffentlich plus each configured group and creates with the chosen slug', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createCategory').mockResolvedValue(categories[0])
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    const group = await screen.findByRole('group', { name: 'Sichtbarkeit' })
    expect(within(group).getByLabelText('Öffentlich')).toBeChecked()
    await user.click(within(group).getByLabelText('IT-Infrastruktur'))

    await user.type(screen.getByLabelText('Slug'), 'rz')
    await user.type(screen.getByLabelText('Label (de)'), 'Rechenzentrum')
    await user.type(screen.getByLabelText('Label (en)'), 'Data centre')
    await user.click(screen.getByRole('button', { name: 'Kategorie anlegen' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0].slice(0, 2)).toEqual(['rz', { de: 'Rechenzentrum', en: 'Data centre' }])
    expect(create.mock.calls[0][3]).toBe('it-infra')
  })

  it('shows a restricted category’s group in its row and prefills it for editing', async () => {
    const user = userEvent.setup()
    const update = vi.spyOn(api, 'updateCategory').mockResolvedValue(categories[1])
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    // The row names the group once /api/me has resolved its label.
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')[1].textContent).toMatch(/IT-Infrastruktur/),
    )

    const row = screen.getAllByRole('listitem')[1]
    await user.click(within(row).getByRole('button', { name: 'Bearbeiten' }))
    const group = screen.getByRole('group', { name: 'Sichtbarkeit' })
    expect(within(group).getByLabelText('IT-Infrastruktur')).toBeChecked()

    // Making it public again is the same write, with an empty slug.
    await user.click(within(group).getByLabelText('Öffentlich'))
    await user.click(screen.getByRole('button', { name: 'Kategorie speichern' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][1]).toMatchObject({ slug: 'infra', visibility: '' })
  })
})

// The form shows a hint derived from the chosen categories — never a control:
// restriction is a property of the category (spec §2.2).
describe('Admin service form category hint', () => {
  it('says nothing while only public categories are chosen', async () => {
    const user = userEvent.setup()
    render(
      <ServiceForm categories={categories} locale="de" visibilityOptions={[itInfra]} onSubmit={() => {}} onCancel={() => {}} />,
    )
    expect(screen.queryByText(/eingeschränkten Kategorie/)).not.toBeInTheDocument()
    await user.click(screen.getByText('Labore'))
    expect(screen.queryByText(/eingeschränkten Kategorie/)).not.toBeInTheDocument()
    // And there is no visibility control of its own any more.
    expect(screen.queryByRole('group', { name: 'Sichtbarkeit' })).not.toBeInTheDocument()
  })

  it('names the group once a restricted category is chosen, and submits no visibility field', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ServiceForm categories={categories} locale="de" visibilityOptions={[itInfra]} onSubmit={onSubmit} onCancel={() => {}} />,
    )
    await user.type(screen.getByLabelText(/^Name/), 'Backup')
    await user.type(screen.getByLabelText(/^Beschreibung \(Deutsch\)/), 'Sicherung.')
    await user.type(screen.getByLabelText(/^Beschreibung \(English\)/), 'Backups.')
    await user.type(screen.getByLabelText(/Service-URL/), 'https://backup.example.edu')
    await user.click(screen.getByText('Infrastruktur'))

    expect(screen.getByText(/nur für IT-Infrastruktur sichtbar/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Anlegen' }))
    const draft = onSubmit.mock.calls[0][0]
    expect(draft).toMatchObject({ name: 'Backup', categories: ['infra'] })
    expect(draft).not.toHaveProperty('visibility')
  })
})

describe('Role-defaults picker', () => {
  it('offers public services only, from the unnarrowed admin catalog', async () => {
    const roles: Role[] = [{ slug: 'student', label: { de: 'Studierende', en: 'Students' } }]
    vi.spyOn(api, 'roles').mockResolvedValue(roles)
    vi.spyOn(api, 'adminServices').mockResolvedValue({
      services: [
        adminService({}),
        adminService({ id: 'x1', name: 'Zettelkasten Labor', categories: ['infra'] }),
        adminService({ id: 'g1', name: 'Abgeschaltet', is_active: false }),
      ],
    })
    vi.spyOn(api, 'adminCategories').mockResolvedValue({ categories })
    vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: [] })
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    const select = await screen.findByRole('combobox', { name: 'Hinzufügen' })
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('VPN')
    // In a restricted category, so it can never be a default (the server
    // enforces it too).
    expect(options).not.toContain('Zettelkasten Labor')
    expect(options).not.toContain('Abgeschaltet')
  })
})

// Review finding 2 (carried over from v1): an id in the role's saved list the
// catalog cannot resolve must render as an unavailable placeholder row and
// survive Save, never be silently dropped and deleted.
describe('Role-defaults editor with an unresolvable default', () => {
  it('renders a placeholder row and preserves the id on Save', async () => {
    const roles: Role[] = [{ slug: 'student', label: { de: 'Studierende', en: 'Students' } }]
    vi.spyOn(api, 'roles').mockResolvedValue(roles)
    vi.spyOn(api, 'adminServices').mockResolvedValue({ services: [adminService({})] })
    vi.spyOn(api, 'adminCategories').mockResolvedValue({ categories })
    vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: ['p1', 'hidden-1'] })
    const save = vi.spyOn(api, 'setRoleDefaults').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    const list = await screen.findByRole('list')
    const rows = () => within(list).getAllByRole('listitem').map((li) => li.textContent ?? '')
    // The list renders its empty-state row until the defaults arrive.
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0]).toMatch(/VPN/)
    expect(rows()[1]).toMatch(/Nicht verfügbar/)

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(save).toHaveBeenCalledWith('student', ['p1', 'hidden-1'])
  })
})
