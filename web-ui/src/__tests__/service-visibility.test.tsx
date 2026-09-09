import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Tile } from '@/components/Tile'
import { TopBar } from '@/components/TopBar'
import { CategoriesAdmin } from '@/components/admin/CategoriesAdmin'
import { ServicesAdmin } from '@/components/admin/ServicesAdmin'
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

// The one marker, on all three surfaces: the admin category row (the reference
// treatment), the admin service row, and the holder's own filter pill and
// section heading. Every one of them must say what it means — a bare lock with
// no accessible name is worse than no marker.
describe('the restricted marker', () => {
  beforeEach(() => {
    vi.spyOn(api, 'me').mockResolvedValue(me())
  })

  it('marks a restricted category in the admin list, and leaves a public one alone', async () => {
    render(withClient(<CategoriesAdmin categories={categories} locale="de" />))

    const rows = await screen.findAllByRole('listitem')
    await waitFor(() =>
      expect(within(rows[1]).getByText('Nur für IT-Infrastruktur sichtbar')).toBeInTheDocument(),
    )
    // The group's name is what the marker shows…
    expect(within(rows[1]).getByText('IT-Infrastruktur')).toBeInTheDocument()
    // …and the public category carries nothing.
    expect(within(rows[0]).queryByText(/Nur für/)).not.toBeInTheDocument()
  })

  it('marks a service in a restricted category, once, naming every group', async () => {
    vi.spyOn(api, 'adminServices').mockResolvedValue({
      services: [
        adminService({}),
        adminService({ id: 'x1', name: 'Serververwaltung', categories: ['infra'] }),
        // Two restricted categories: one marker, both groups named.
        adminService({ id: 'x2', name: 'Doppelt', categories: ['infra', 'netz'] }),
      ],
    })
    const twoGroups: Category[] = [
      ...categories,
      { slug: 'netz', label: { de: 'Netz', en: 'Network' }, sort: 30, visibility: 'net-ops' },
    ]
    vi.spyOn(api, 'me').mockResolvedValue(
      me({ visibility: { held: [], entries: [itInfra, { slug: 'net-ops', label: { de: 'Netzbetrieb', en: 'Net ops' } }] } }),
    )
    render(withClient(<ServicesAdmin categories={twoGroups} categoriesReady locale="de" />))

    const rows = await screen.findAllByRole('listitem')
    const row = (name: string) => rows.find((r) => r.textContent?.includes(name)) as HTMLElement
    await waitFor(() =>
      expect(within(row('Serververwaltung')).getByText('Nur für IT-Infrastruktur sichtbar')).toBeInTheDocument(),
    )
    expect(within(row('VPN')).queryByText(/Nur für/)).not.toBeInTheDocument()

    const both = within(row('Doppelt')).getAllByText(/Nur für/)
    expect(both, 'one marker per row, however many restricted categories').toHaveLength(1)
    expect(both[0].textContent?.trim()).toBe('Nur für IT-Infrastruktur, Netzbetrieb sichtbar')
  })

  it('renders no marker until the category list has answered', async () => {
    vi.spyOn(api, 'adminServices').mockResolvedValue({
      services: [adminService({ id: 'x1', name: 'Serververwaltung', categories: ['infra'] })],
    })
    render(withClient(<ServicesAdmin categories={[]} categoriesReady={false} locale="de" />))

    await screen.findByText('Serververwaltung')
    expect(screen.queryByText(/Nur für/)).not.toBeInTheDocument()
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

  // Review finding 4: a category restricted to a group the config no longer
  // defines must stay editable — the stale slug is offered as its own choice so
  // it can be cleared. v1's ServiceForm did exactly this; the handling has to
  // move with the control, not be dropped with it.
  it('keeps a stale group selectable, so the restriction can be cleared', async () => {
    const user = userEvent.setup()
    const update = vi.spyOn(api, 'updateCategory').mockResolvedValue(categories[0])
    const stale: Category[] = [
      { slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 10, visibility: 'gone' },
    ]
    render(withClient(<CategoriesAdmin categories={stale} locale="de" />))

    await user.click((await screen.findAllByRole('button', { name: 'Bearbeiten' }))[0])
    const group = screen.getByRole('group', { name: 'Sichtbarkeit' })
    // Named by its bare slug — there is no label for it any more — and checked,
    // so the admin can see what the category is actually restricted to.
    expect(within(group).getByLabelText('gone')).toBeChecked()
    expect(within(group).getByLabelText('Öffentlich')).not.toBeChecked()

    await user.click(within(group).getByLabelText('Öffentlich'))
    await user.click(screen.getByRole('button', { name: 'Kategorie speichern' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][1]).toMatchObject({ visibility: '' })
  })

  // ...and the selector renders for a stale slug even when the deployment
  // configures no groups at all, which is the state that made it uneditable.
  it('renders the selector for a stale group even with nothing configured', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'me').mockResolvedValue(me({ visibility: { held: [], entries: [] } }))
    const stale: Category[] = [
      { slug: 'infra', label: { de: 'Infrastruktur', en: 'Infrastructure' }, sort: 10, visibility: 'gone' },
    ]
    render(withClient(<CategoriesAdmin categories={stale} locale="de" />))

    await user.click((await screen.findAllByRole('button', { name: 'Bearbeiten' }))[0])
    const group = screen.getByRole('group', { name: 'Sichtbarkeit' })
    expect(within(group).getByLabelText('gone')).toBeChecked()
    expect(within(group).getByLabelText('Öffentlich')).toBeInTheDocument()
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

// Review finding 6: while the category list is still in flight the restricted
// set is unknown, so the picker must offer nothing rather than a service that
// Save would reject with a 400.
describe('Role-defaults picker while the categories are loading', () => {
  it('offers nothing until the unnarrowed category list has answered', async () => {
    const roles: Role[] = [{ slug: 'student', label: { de: 'Studierende', en: 'Students' } }]
    vi.spyOn(api, 'roles').mockResolvedValue(roles)
    vi.spyOn(api, 'adminServices').mockResolvedValue({
      services: [adminService({}), adminService({ id: 'x1', name: 'Zettelkasten Labor', categories: ['infra'] })],
    })
    vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: [] })
    let land: (v: { categories: Category[] }) => void = () => {}
    vi.spyOn(api, 'adminCategories').mockReturnValue(
      new Promise((resolve) => {
        land = resolve
      }),
    )
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    // The services have landed, so without the gate the picker would already be
    // offering them. Nothing is pickable while the category answer is out — and
    // an empty picker renders as no picker at all.
    await screen.findByRole('list')
    expect(screen.queryByRole('combobox', { name: 'Hinzufügen' })).not.toBeInTheDocument()

    land({ categories })
    const select = await screen.findByRole('combobox', { name: 'Hinzufügen' })
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('VPN')
    expect(options).not.toContain('Zettelkasten Labor')
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
