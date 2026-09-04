import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '@/test/axe'
import type { FavoritesOrder, Service } from '@/lib/api'
import { FavoritesArrange, FavoritesOrderBar } from '@/components/FavoritesOrder'

// Issue #125: the favorites order selector and the explicit "Anordnen" edit
// mode. Both are prop-driven — the mutations live in Dashboard — so they can be
// driven here without a QueryClient.
//
// Deliberately no drag & drop anywhere: the whole point of the feature is that
// reordering is button-operable, which is also what makes it testable at this
// level and keyboard-operable for real.

function service(id: string, name: string): Service {
  return {
    id,
    name,
    description: { de: `${name} Beschreibung`, en: `${name} description` },
    service_url: `https://${id}.example.edu`,
    icon: 'cloud',
    categories: [],
    doc_only: false,
  }
}

// A long German compound is the realistic worst case for these rows.
const SERVICES: Service[] = [
  service('s1', 'Speicherwolke'),
  service('s2', 'Videokonferenzsystem'),
  service('s3', 'Lernmanagementsystem'),
]

const names = () =>
  screen.getAllByRole('listitem').map((li) => li.textContent?.replace(/^\d+\.\s*/, '').trim() ?? '')

/** The bar, with the order pref held locally so a click actually switches it. */
function Bar({
  initial = 'usage',
  onSetOrder = () => {},
}: {
  initial?: FavoritesOrder
  onSetOrder?: (next: FavoritesOrder) => void
}) {
  const [order, setOrder] = useState<FavoritesOrder>(initial)
  const [arranging, setArranging] = useState(false)
  return (
    <FavoritesOrderBar
      locale="de"
      order={order}
      onSetOrder={(next) => {
        setOrder(next)
        onSetOrder(next)
      }}
      arranging={arranging}
      onToggleArrange={() => setArranging((a) => !a)}
      canArrange
    />
  )
}

/** The edit mode, with the list held locally the way Dashboard's cache holds it. */
function Arrange({
  onReorder = () => {},
  initial = SERVICES,
}: {
  onReorder?: (serviceIDs: string[]) => void
  initial?: Service[]
}) {
  const [services, setServices] = useState(initial)
  return (
    <FavoritesArrange
      services={services}
      locale="de"
      onReorder={(ids) => {
        setServices(ids.map((id) => initial.find((s) => s.id === id)!))
        onReorder(ids)
      }}
    />
  )
}

describe('FavoritesOrderBar', () => {
  it('offers the three order modes, marking the active one', async () => {
    render(<Bar />)
    const group = screen.getByRole('group', { name: 'Reihenfolge' })
    expect(within(group).getByRole('button', { name: 'Häufig genutzt' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Alphabetisch' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: 'Eigene Reihenfolge' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('persists the pick through onSetOrder', async () => {
    const onSetOrder = vi.fn()
    render(<Bar onSetOrder={onSetOrder} />)
    await userEvent.click(screen.getByRole('button', { name: 'Alphabetisch' }))
    expect(onSetOrder).toHaveBeenCalledWith('alpha')
  })

  // The edit mode is explicit (the admin role-defaults idiom) and only exists
  // where it means something: there is nothing to arrange in a computed order.
  it('reveals the Anordnen toggle only in manual mode', async () => {
    render(<Bar />)
    expect(screen.queryByRole('button', { name: 'Anordnen' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Eigene Reihenfolge' }))
    const arrange = screen.getByRole('button', { name: 'Anordnen' })
    expect(arrange).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(arrange)
    expect(screen.getByRole('button', { name: 'Fertig' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('has no axe violations in either state', async () => {
    const { baseElement } = render(<Bar initial="manual" />)
    await expectNoAxeViolations(baseElement, ['region'])
    await userEvent.click(screen.getByRole('button', { name: 'Anordnen' }))
    await expectNoAxeViolations(baseElement, ['region'])
  })
})

describe('FavoritesArrange', () => {
  it('renders one numbered row per favorite, with the three move actions', () => {
    render(<Arrange />)
    expect(names()).toEqual(['Speicherwolke', 'Videokonferenzsystem', 'Lernmanagementsystem'])

    // Localized, per-row accessible names — an icon button that only said
    // "Nach oben" would be three identical buttons to a screen reader.
    expect(screen.getByRole('button', { name: 'Nach unten – Speicherwolke' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nach oben – Videokonferenzsystem' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'An den Anfang – Lernmanagementsystem' })).toBeInTheDocument()
  })

  it('disables the moves that would leave the list', () => {
    render(<Arrange />)
    expect(screen.getByRole('button', { name: 'Nach oben – Speicherwolke' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'An den Anfang – Speicherwolke' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nach unten – Lernmanagementsystem' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nach unten – Speicherwolke' })).toBeEnabled()
  })

  it('moves a row down and reports the whole new order', async () => {
    const onReorder = vi.fn()
    render(<Arrange onReorder={onReorder} />)
    await userEvent.click(screen.getByRole('button', { name: 'Nach unten – Speicherwolke' }))
    expect(onReorder).toHaveBeenCalledWith(['s2', 's1', 's3'])
    expect(names()).toEqual(['Videokonferenzsystem', 'Speicherwolke', 'Lernmanagementsystem'])
  })

  it('moves a row up', async () => {
    const onReorder = vi.fn()
    render(<Arrange onReorder={onReorder} />)
    await userEvent.click(screen.getByRole('button', { name: 'Nach oben – Lernmanagementsystem' }))
    expect(onReorder).toHaveBeenCalledWith(['s1', 's3', 's2'])
  })

  it('moves a row to the top', async () => {
    const onReorder = vi.fn()
    render(<Arrange onReorder={onReorder} />)
    await userEvent.click(screen.getByRole('button', { name: 'An den Anfang – Lernmanagementsystem' }))
    expect(onReorder).toHaveBeenCalledWith(['s3', 's1', 's2'])
    expect(names()).toEqual(['Lernmanagementsystem', 'Speicherwolke', 'Videokonferenzsystem'])
  })

  it('announces each move in the polite live region', async () => {
    render(<Arrange />)
    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('')

    await userEvent.click(screen.getByRole('button', { name: 'Nach unten – Speicherwolke' }))
    await waitFor(() => expect(live).toHaveTextContent('Speicherwolke an Position 2 von 3'))
  })

  // Keyboard-only reordering: tab to a move button, press it repeatedly, and
  // focus has to stay on the row you are moving — otherwise every step throws
  // the user back to the top of the page.
  it('keeps focus on the moved row across repeated keyboard moves', async () => {
    render(<Arrange />)
    const down = screen.getByRole('button', { name: 'Nach unten – Speicherwolke' })
    down.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nach unten – Speicherwolke' })).toHaveFocus())
    expect(names()).toEqual(['Videokonferenzsystem', 'Speicherwolke', 'Lernmanagementsystem'])

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(names()).toEqual(['Videokonferenzsystem', 'Lernmanagementsystem', 'Speicherwolke']))
    // Last row: ▼ is now disabled, so focus lands on the action that still
    // works rather than falling back to the document body.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nach oben – Speicherwolke' })).toHaveFocus())
  })

  it('hands focus to a usable action after a move to the top disables the one pressed', async () => {
    render(<Arrange />)
    screen.getByRole('button', { name: 'An den Anfang – Lernmanagementsystem' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(names()[0]).toBe('Lernmanagementsystem'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Nach unten – Lernmanagementsystem' })).toHaveFocus(),
    )
  })

  it('has no axe violations', async () => {
    const { baseElement } = render(<Arrange />)
    await expectNoAxeViolations(baseElement, ['region'])
  })

  it('shows the favorites empty copy instead of an empty list', () => {
    render(<Arrange initial={[]} />)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(/Noch keine Favoriten/)).toBeInTheDocument()
  })
})
