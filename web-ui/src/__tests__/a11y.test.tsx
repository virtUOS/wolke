import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings, Star } from 'lucide-react'
import { expectNoAxeViolations } from '@/test/axe'
import type { Branding } from '@/lib/branding'
import type { Me, Service, Category } from '@/lib/api'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { List, ListItem } from '@/components/ui/list'
import { PillButton } from '@/components/ui/pill-button'
import { Dialog } from '@/components/ui/dialog'
import { Popover } from '@/components/ui/popover'
import { Greeting } from '@/components/Greeting'
import { CatalogView } from '@/components/CatalogView'
import { TopBar } from '@/components/TopBar'

// axe runs with color-contrast disabled (jsdom can't compute layout/colors;
// contrast is an e2e/manual concern). This pass covers ARIA, roles, names, and
// label associations across the primitives and the prop-driven views — the
// data-backed views (Dashboard, admin) need a QueryClient and are audited
// manually + via their own component tests.

// `region` (all content must be in a landmark) is a page-level rule; these
// components live inside the app's <main> in production, so it's disabled for
// these isolated renders. Everything else (ARIA, roles, names, associations)
// is still asserted.
const a11y = (el: HTMLElement) => expectNoAxeViolations(el, ['region'])

const CATS: Category[] = [{ slug: 'lernen', label: { de: 'Lernen', en: 'Learning' }, sort: 0 }]
const SERVICE: Service = {
  id: 's1',
  name: 'VPN',
  description: { de: 'Zugang', en: 'Access' },
  service_url: 'https://vpn.example.edu',
  doc_url: 'https://docs.example.edu',
  icon: 'shield',
  categories: ['lernen'],
  doc_only: false,
  tag: 'wartung',
}

describe('a11y (axe) — UI primitives', () => {
  it('Button / IconButton / Badge / Card', async () => {
    const { baseElement } = render(
      <div>
        <Button>Speichern</Button>
        <IconButton aria-label="Favorit">
          <Star aria-hidden="true" />
        </IconButton>
        <Badge variant="warning">Wartung</Badge>
        <Card>Inhalt</Card>
      </div>,
    )
    await a11y(baseElement)
  })

  it('Alert with title + dismiss', async () => {
    const { baseElement } = render(
      <Alert variant="warning" title="Hinweis" dismissLabel="Schließen" onDismiss={() => {}}>
        Wartungsarbeiten heute Abend.
      </Alert>,
    )
    await a11y(baseElement)
  })

  it('Field-wrapped Input / Textarea / Select (label association, error)', async () => {
    const { baseElement } = render(
      <form>
        <Field label="Name" required>
          <Input defaultValue="VPN" />
        </Field>
        <Field label="Beschreibung">
          <Textarea defaultValue="…" />
        </Field>
        <Field label="Rolle" error="Pflichtfeld">
          <Select defaultValue="a">
            <option value="a">A</option>
            <option value="b">B</option>
          </Select>
        </Field>
      </form>,
    )
    await a11y(baseElement)
  })

  it('List / PillButton', async () => {
    const { baseElement } = render(
      <div>
        <List>
          <ListItem>Eins</ListItem>
          <ListItem>Zwei</ListItem>
        </List>
        <PillButton active aria-current="page">
          Dienste
        </PillButton>
      </div>,
    )
    await a11y(baseElement)
  })

  it('Dialog (open, modal)', async () => {
    const { baseElement } = render(
      <Dialog
        open
        onOpenChange={() => {}}
        title="Abmelden?"
        description="Single Sign-out."
        footer={<Button>Abmelden</Button>}
      >
        <p>Sie werden abgemeldet.</p>
      </Dialog>,
    )
    await a11y(baseElement)
  })

  it('Popover (opened)', async () => {
    const { baseElement } = render(
      <Popover label="Einstellungen" icon={<Settings aria-hidden="true" />}>
        <button>Eine Aktion</button>
      </Popover>,
    )
    await userEvent.click(baseElement.querySelector('button')!)
    await a11y(baseElement)
  })
})

describe('a11y (axe) — prop-driven views', () => {
  it('Greeting renders the salutation as the page h1', async () => {
    const { baseElement } = render(
      <Greeting firstName="Tim" locale="de" isMobile={false} favCount={3} maintenanceCount={2} onShowFavorites={() => {}} onShowMaintenance={() => {}} />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tim')
    await a11y(baseElement)
  })

  it('CatalogView (grid) — tile link name carries status + new-tab', async () => {
    const { baseElement } = render(<CatalogView services={[SERVICE]} categories={CATS} locale="de" layout="grid" />)
    // The maintenance status and new-tab warning must be in the link's name, not
    // conveyed by the badge colour alone.
    const link = screen.getByRole('link', { name: /VPN/ })
    expect(link).toHaveAccessibleName(/in Wartung/)
    expect(link).toHaveAccessibleName(/neuem Tab/)
    await a11y(baseElement)
  })

  it('CatalogView (empty state)', async () => {
    const { baseElement } = render(<CatalogView services={[]} categories={CATS} locale="de" layout="list" />)
    await a11y(baseElement)
  })

  it('TopBar', async () => {
    const branding = {
      product_name: 'wolke',
      org_name: 'Uni',
      logo_light: '/l.svg',
      logo_dark: '/d.svg',
      favicon: '/f.svg',
      default_locale: 'de',
      imprint_url: 'https://example.edu/impressum',
      privacy_url: 'https://example.edu/datenschutz',
      feedback_url: 'feedback@example.edu',
      bot_url: 'https://example.edu/bot',
      help_url: '+49 541 9690',
      theme: { light: {}, dark: {} },
    } as Branding
    const me = { display_name: 'Tim B', email: 't@example.edu', is_admin: true } as Me
    const { baseElement } = render(
      <TopBar
        branding={branding}
        locale="de"
        currentLocalePref="auto"
        tab="dienste"
        onTab={() => {}}
        isDark={false}
        onToggleTheme={() => {}}
        onSetLocale={() => {}}
        userInitials="TB"
        userName={me.display_name}
        userEmail={me.email}
        isAdmin={me.is_admin}
        onAdmin={() => {}}
        onLogout={() => {}}
      />,
    )
    await a11y(baseElement)
  })
})
