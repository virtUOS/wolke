import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Tile } from '@/components/Tile'
import { TopBar } from '@/components/TopBar'
import { RoleDefaultsAdmin } from '@/components/admin/RoleDefaultsAdmin'
import { ServiceForm } from '@/components/admin/ServiceForm'
import { api, type Category, type Role, type Service, type VisibilityEntry } from '@/lib/api'
import type { Branding } from '@/lib/branding'
import { expectNoAxeViolations } from '@/test/axe'

// Service visibility, opt-in flavour (issue #34, docs/specs/service-visibility.md):
// the badge in the tile's status slot, the account-menu switch behind its
// warning dialog, the admin selector, and the public-only role-defaults picker.

const experimental: VisibilityEntry = {
  slug: 'experimental',
  label: { de: 'Experimentell', en: 'Experimental' },
  grant: 'opt-in',
  warning: {
    de: 'Experimentelle Dienste können jederzeit ohne Vorankündigung verschwinden; Daten gehen dabei möglicherweise verloren und werden nicht migriert.',
    en: 'Experimental services can disappear at any time without notice; data may be lost and will not be migrated.',
  },
}
const itInfra: VisibilityEntry = {
  slug: 'it-infra',
  label: { de: 'IT-Infrastruktur', en: 'IT infrastructure' },
  grant: 'claim',
}

const categories: Category[] = [{ slug: 'labs', label: { de: 'Labore', en: 'Labs' }, sort: 10 }]
const restricted: Service = {
  id: 'x1',
  name: 'Zettelkasten Labor',
  description: { de: 'Ein Versuch.', en: 'An experiment.' },
  service_url: 'https://lab.example.edu',
  icon: 'flask-conical',
  categories: ['labs'],
  doc_only: false,
  visibility: 'experimental',
}
const publicSvc: Service = { ...restricted, id: 'p1', name: 'VPN', visibility: undefined }

const branding = {
  product_name: 'wolke', org_name: 'Uni', logo_light: '/l.svg', logo_dark: '/d.svg', favicon: '/f.svg',
  default_locale: 'de', imprint_url: '', privacy_url: '', feedback_url: '', bot_url: '', help_url: '',
  assistant_widget_url: '', assistant_bot_id: '', theme: { light: {}, dark: {} },
} as Branding

function withClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('Tile visibility badge', () => {
  it('shows the group label in the status slot and folds it into the accessible name', () => {
    render(
      <Tile service={restricted} categories={categories} locale="de" visibilityLabels={{ experimental: 'Experimentell' }} />,
    )
    expect(screen.getByText('Experimentell')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Zettelkasten Labor öffnen \(Experimentell\)/ })).toBeInTheDocument()
  })

  it('falls back to the slug when no label is known, and renders nothing for a public service', () => {
    const { rerender } = render(<Tile service={restricted} categories={categories} locale="de" />)
    expect(screen.getByText('experimental')).toBeInTheDocument()
    rerender(<Tile service={publicSvc} categories={categories} locale="de" visibilityLabels={{ experimental: 'Experimentell' }} />)
    expect(screen.queryByText('Experimentell')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'VPN öffnen (öffnet in neuem Tab)' })).toBeInTheDocument()
  })

  it('renders the list layout badge too, without axe violations', async () => {
    const { container } = render(
      <Tile service={restricted} categories={categories} locale="de" layout="list" visibilityLabels={{ experimental: 'Experimentell' }} />,
    )
    expect(screen.getByText('Experimentell')).toBeInTheDocument()
    await expectNoAxeViolations(container, ['region'])
  })
})

describe('Account menu opt-in switch', () => {
  beforeEach(() => {
    vi.spyOn(api, 'announcements').mockResolvedValue({ announcements: [] })
  })

  function renderMenu(optin: string[], onSet = vi.fn(), entries: VisibilityEntry[] = [experimental, itInfra]) {
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
          visibilityEntries={entries}
          visibilityOptIn={optin}
          onSetVisibilityOptIn={onSet}
        />,
      ),
    )
    return onSet
  }

  it('renders one switch per opt-in entry and none for claim entries', async () => {
    const user = userEvent.setup()
    renderMenu([])
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    const menu = screen.getByRole('dialog', { name: 'Konto' })
    expect(within(menu).getByRole('switch', { name: 'Experimentell anzeigen' })).toHaveAttribute('aria-checked', 'false')
    expect(within(menu).queryByRole('switch', { name: /IT-Infrastruktur/ })).not.toBeInTheDocument()
    await expectNoAxeViolations(menu, ['region'])
  })

  it('renders no visibility section when nothing is configured', async () => {
    const user = userEvent.setup()
    renderMenu([], vi.fn(), [])
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText('Sichtbarkeit')).not.toBeInTheDocument()
  })

  it('enabling asks for confirmation with the configured warning, then persists the list', async () => {
    const user = userEvent.setup()
    const onSet = renderMenu([])
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    await user.click(screen.getByRole('switch', { name: 'Experimentell anzeigen' }))

    // Nothing written yet: the warning comes first.
    expect(onSet).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Experimentell anzeigen?' })
    expect(within(dialog).getByText(/ohne Vorankündigung verschwinden/)).toBeInTheDocument()
    // The menu stepped aside so the two overlays never fight over focus.
    expect(screen.queryByRole('dialog', { name: 'Konto' })).not.toBeInTheDocument()
    await expectNoAxeViolations(dialog, ['region'])

    await user.click(within(dialog).getByRole('button', { name: 'Anzeigen' }))
    expect(onSet).toHaveBeenCalledWith(['experimental'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Focus returns to the avatar trigger, not to <body>.
    expect(screen.getByRole('button', { name: 'Konto-Menü öffnen' })).toHaveFocus()
  })

  it('cancelling the warning writes nothing', async () => {
    const user = userEvent.setup()
    const onSet = renderMenu([])
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    await user.click(screen.getByRole('switch', { name: 'Experimentell anzeigen' }))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onSet).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('disabling is immediate — nothing is lost, so no dialog', async () => {
    const user = userEvent.setup()
    const onSet = renderMenu(['experimental'])
    await user.click(screen.getByRole('button', { name: 'Konto-Menü öffnen' }))
    const sw = screen.getByRole('switch', { name: 'Experimentell anzeigen' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    expect(onSet).toHaveBeenCalledWith([])
    expect(screen.queryByRole('dialog', { name: /anzeigen\?/ })).not.toBeInTheDocument()
  })
})

describe('Admin service form visibility selector', () => {
  it('is absent when the deployment configures no visibility', () => {
    render(<ServiceForm categories={categories} locale="de" onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.queryByText('Sichtbarkeit')).not.toBeInTheDocument()
  })

  it('offers Öffentlich plus each configured label and submits the chosen slug', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ServiceForm
        categories={categories}
        locale="de"
        visibilityOptions={[experimental, itInfra]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    const group = screen.getByRole('group', { name: 'Sichtbarkeit' })
    expect(within(group).getByLabelText('Öffentlich')).toBeChecked()
    expect(within(group).getByLabelText('IT-Infrastruktur')).toBeInTheDocument()
    await user.click(within(group).getByLabelText('Experimentell'))
    // The live preview badges the tile as the users will see it.
    expect(screen.getByRole('link', { name: /\(Experimentell\)/ })).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^Name/), 'Zettelkasten Labor')
    await user.type(screen.getByLabelText(/^Beschreibung \(Deutsch\)/), 'Ein Versuch.')
    await user.type(screen.getByLabelText(/^Beschreibung \(English\)/), 'An experiment.')
    await user.type(screen.getByLabelText(/Service-URL/), 'https://lab.example.edu')
    await user.click(screen.getByText('Labore'))
    await user.click(screen.getByRole('button', { name: 'Anlegen' }))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'Zettelkasten Labor', visibility: 'experimental' })
  })

  it('keeps a stored slug the deployment no longer configures selectable, so it can be cleared', () => {
    render(
      <ServiceForm
        categories={categories}
        locale="de"
        visibilityOptions={[]}
        initial={{ ...restricted, is_active: true, keywords: [], visibility: 'gone' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    const group = screen.getByRole('group', { name: 'Sichtbarkeit' })
    expect(within(group).getByLabelText('gone')).toBeChecked()
    expect(within(group).getByLabelText('Öffentlich')).not.toBeChecked()
  })
})

describe('Role-defaults picker', () => {
  it('offers public services only (spec §7.1)', async () => {
    const roles: Role[] = [{ slug: 'student', label: { de: 'Studierende', en: 'Students' } }]
    vi.spyOn(api, 'roles').mockResolvedValue(roles)
    vi.spyOn(api, 'catalog').mockResolvedValue({ services: [publicSvc, restricted], categories })
    vi.spyOn(api, 'roleDefaults').mockResolvedValue({ service_ids: [] })
    render(withClient(<RoleDefaultsAdmin locale="de" />))

    const select = await screen.findByRole('combobox', { name: 'Hinzufügen' })
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('VPN')
    expect(options).not.toContain('Zettelkasten Labor')
  })
})
