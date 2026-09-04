import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '@/test/axe'
import type { FavoritesOrder, Service } from '@/lib/api'
import { FavoritesArrange, FavoritesSortMenu } from '@/components/FavoritesOrder'

// Issue #125: the favorites sort menu (the compact trigger beside the
// "Favoriten" heading, opening a popover on desktop and a bottom sheet on a
// phone) and the explicit "Anordnen" edit mode. Both are prop-driven — the
// mutations live in Dashboard — so they can be driven here without a
// QueryClient.
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

/** The menu, with the order pref held locally so a pick actually switches it. */
function Menu({
  initial = 'usage',
  onSetOrder = () => {},
  onArrange = () => {},
  isMobile = false,
  canArrange = true,
}: {
  initial?: FavoritesOrder
  onSetOrder?: (next: FavoritesOrder) => void
  onArrange?: () => void
  isMobile?: boolean
  canArrange?: boolean
}) {
  const [order, setOrder] = useState<FavoritesOrder>(initial)
  return (
    <FavoritesSortMenu
      locale="de"
      order={order}
      onSetOrder={(next) => {
        setOrder(next)
        onSetOrder(next)
      }}
      onArrange={onArrange}
      canArrange={canArrange}
      isMobile={isMobile}
    />
  )
}

/** Opens the menu and returns its panel (popover or sheet — both role=dialog). */
async function openMenu(initialLabel = 'Häufig genutzt') {
  await userEvent.click(screen.getByRole('button', { name: `Reihenfolge: ${initialLabel}` }))
  return screen.getByRole('dialog')
}

/** The edit mode, with the list held locally the way Dashboard's cache holds it. */
function Arrange({
  onReorder = () => {},
  onDone = () => {},
  onCancel = () => {},
  initial = SERVICES,
}: {
  onReorder?: (serviceIDs: string[]) => void
  onDone?: () => void
  onCancel?: () => void
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
      onDone={onDone}
      onCancel={onCancel}
    />
  )
}

describe('FavoritesSortMenu', () => {
  // The trigger's visible text is the active order; its accessible name has to
  // say what that text *is* while still containing it ("label in name").
  it('labels the trigger with the active order', async () => {
    render(<Menu initial="alpha" />)
    const trigger = screen.getByRole('button', { name: 'Reihenfolge: Alphabetisch' })
    expect(trigger).toHaveTextContent('Alphabetisch')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a popover with the three order modes, marking the active one', async () => {
    render(<Menu />)
    const panel = await openMenu()
    const group = within(panel).getByRole('radiogroup', { name: 'Reihenfolge' })
    expect(within(group).getByRole('radio', { name: 'Häufig genutzt' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Alphabetisch' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Eigene Reihenfolge' })).not.toBeChecked()
  })

  it('persists the pick through onSetOrder and keeps the panel open', async () => {
    const onSetOrder = vi.fn()
    render(<Menu onSetOrder={onSetOrder} />)
    const panel = await openMenu()
    await userEvent.click(within(panel).getByRole('radio', { name: 'Alphabetisch' }))
    expect(onSetOrder).toHaveBeenCalledWith('alpha')
    // Applied immediately, no confirm step — and the panel is still there.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Alphabetisch' })).toBeChecked()
    // The trigger relabels to what was just picked.
    expect(screen.getByRole('button', { name: 'Reihenfolge: Alphabetisch' })).toBeInTheDocument()
  })

  // The radios are real inputs precisely so this comes from the platform:
  // arrow keys move *and* select, which is what "applies immediately" means.
  it('selects with the arrow keys', async () => {
    const onSetOrder = vi.fn()
    render(<Menu onSetOrder={onSetOrder} />)
    const panel = await openMenu()
    within(panel).getByRole('radio', { name: 'Häufig genutzt' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(onSetOrder).toHaveBeenCalledWith('alpha')
  })

  // A sr-only input's own ring renders nowhere, so the visible indicator has to
  // carry it — the bug ChoiceChip fixed for the category chips.
  it('puts the focus ring on the visible radio indicator', async () => {
    render(<Menu />)
    const panel = await openMenu()
    const radio = within(panel).getByRole('radio', { name: 'Häufig genutzt' })
    expect(radio.className).toMatch(/\bsr-only\b/)
    expect(radio.className).toMatch(/\bpeer\b/)
    const indicator = radio.nextElementSibling as HTMLElement
    expect(indicator.className).toMatch(/peer-focus-visible:ring-2/)
    expect(indicator.className).toMatch(/peer-focus-visible:ring-\[var\(--primary\)\]/)
  })

  // The edit mode only exists where it means something: there is nothing to
  // arrange in a computed order.
  it('reveals Anordnen only in manual mode', async () => {
    render(<Menu />)
    const panel = await openMenu()
    expect(within(panel).queryByRole('button', { name: 'Anordnen' })).not.toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('radio', { name: 'Eigene Reihenfolge' }))
    expect(screen.getByRole('button', { name: 'Anordnen' })).toBeInTheDocument()
  })

  it('hides Anordnen in manual mode when there is nothing to arrange', async () => {
    render(<Menu initial="manual" canArrange={false} />)
    await openMenu('Eigene Reihenfolge')
    expect(screen.queryByRole('button', { name: 'Anordnen' })).not.toBeInTheDocument()
  })

  it('opens the edit mode through onArrange', async () => {
    const onArrange = vi.fn()
    render(<Menu initial="manual" onArrange={onArrange} />)
    await openMenu('Eigene Reihenfolge')
    await userEvent.click(screen.getByRole('button', { name: 'Anordnen' }))
    expect(onArrange).toHaveBeenCalled()
  })

  it('closes the popover on Escape and returns focus to the trigger', async () => {
    render(<Menu />)
    await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reihenfolge: Häufig genutzt' })).toHaveFocus()
  })

  it('has no axe violations, closed and open', async () => {
    const { baseElement } = render(<Menu initial="manual" />)
    await expectNoAxeViolations(baseElement, ['region'])
    await openMenu('Eigene Reihenfolge')
    await expectNoAxeViolations(baseElement, ['region'])
  })

  describe('on a phone', () => {
    it('opens a bottom sheet with the same radio group', async () => {
      render(<Menu isMobile />)
      const sheet = await openMenu()
      expect(sheet).toHaveAttribute('aria-modal', 'true')
      expect(within(sheet).getByRole('radiogroup', { name: 'Reihenfolge' })).toBeInTheDocument()
      expect(within(sheet).getAllByRole('radio')).toHaveLength(3)
    })

    // A scrim tap has no accessible name and a phone has no Escape key, so the
    // sheet must carry a real, named, focusable way out (it is the drag handle).
    it('offers a labelled close control', async () => {
      render(<Menu isMobile />)
      const sheet = await openMenu()
      const close = within(sheet).getByRole('button', { name: 'Schließen' })
      close.focus()
      expect(close).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('closes the sheet when the edit mode opens', async () => {
      const onArrange = vi.fn()
      render(<Menu initial="manual" isMobile onArrange={onArrange} />)
      await openMenu('Eigene Reihenfolge')
      await userEvent.click(screen.getByRole('button', { name: 'Anordnen' }))
      expect(onArrange).toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('has no axe violations with the sheet open', async () => {
      const { baseElement } = render(<Menu initial="manual" isMobile />)
      await openMenu('Eigene Reihenfolge')
      await expectNoAxeViolations(baseElement, ['region'])
    })
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

  // The Abbrechen · Anordnen · Fertig bar owns the view: it is the only way out
  // of the edit mode now that the order pills are gone.
  it('leaves the edit mode through Fertig, keeping the arrangement', async () => {
    const onDone = vi.fn()
    const onReorder = vi.fn()
    render(<Arrange onDone={onDone} onReorder={onReorder} />)
    await userEvent.click(screen.getByRole('button', { name: 'Nach unten – Speicherwolke' }))
    onReorder.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(onDone).toHaveBeenCalled()
    // Nothing is written on the way out: every move already wrote through.
    expect(onReorder).not.toHaveBeenCalled()
  })

  // Abbrechen is not a discarded draft — the moves were already persisted — so
  // it restores the order the screen was entered with, through the same write.
  it('restores the entry order through Abbrechen', async () => {
    const onCancel = vi.fn()
    const onReorder = vi.fn()
    render(<Arrange onCancel={onCancel} onReorder={onReorder} />)

    await userEvent.click(screen.getByRole('button', { name: 'An den Anfang – Lernmanagementsystem' }))
    expect(names()).toEqual(['Lernmanagementsystem', 'Speicherwolke', 'Videokonferenzsystem'])
    onReorder.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onReorder).toHaveBeenCalledWith(['s1', 's2', 's3'])
    expect(onCancel).toHaveBeenCalled()
  })

  it('writes nothing when Abbrechen follows no move at all', async () => {
    const onCancel = vi.fn()
    const onReorder = vi.fn()
    render(<Arrange onCancel={onCancel} onReorder={onReorder} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onReorder).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows the favorites empty copy instead of an empty list', () => {
    render(<Arrange initial={[]} />)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(/Noch keine Favoriten/)).toBeInTheDocument()
  })
})
