import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Dialog } from '../dialog'

function Harness({ initial = true }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Dienst löschen?"
        description="Das kann rückgängig gemacht werden."
        footer={<button onClick={() => setOpen(false)}>Ja</button>}
      >
        <p>body</p>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('is absent when closed and exposes a labelled modal when open', () => {
    const { rerender } = render(
      <Dialog open={false} onOpenChange={() => {}} title="T">
        x
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Dialog open onOpenChange={() => {}} title="T">
        x
      </Dialog>,
    )
    const dlg = screen.getByRole('dialog', { name: 'T' })
    expect(dlg).toHaveAttribute('aria-modal', 'true')
  })

  it('moves focus into the dialog on open', () => {
    render(<Harness />)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape', async () => {
    render(<Harness />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on overlay click and via a footer action', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByText('Ja'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('restores focus to the trigger after closing', async () => {
    render(<Harness initial={false} />)
    const trigger = screen.getByText('open')
    trigger.focus()
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(trigger)
  })
})

// variant="sheet" — the phone-width bottom sheet. Same behaviour set as the
// centred card; what it must not lose is a *named* way out: a scrim tap has no
// accessible name and a phone has no Escape key, so the drag handle is a real
// button carrying `closeLabel`.
describe('Dialog variant="sheet"', () => {
  function Sheet({ initial = true }: { initial?: boolean }) {
    const [open, setOpen] = useState(initial)
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <Dialog variant="sheet" open={open} onOpenChange={setOpen} title="Reihenfolge" closeLabel="Schließen">
          <button>eine Option</button>
        </Dialog>
      </>
    )
  }

  it('is a modal dialog named by its title', () => {
    render(<Sheet />)
    const sheet = screen.getByRole('dialog', { name: 'Reihenfolge' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
  })

  it('closes through a labelled, focusable control rather than the scrim alone', async () => {
    render(<Sheet />)
    const close = screen.getByRole('button', { name: 'Schließen' })
    close.focus()
    expect(document.activeElement).toBe(close)
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the ✕ header out of the sheet but not the close affordance', () => {
    render(<Sheet />)
    const sheet = screen.getByRole('dialog')
    // One way out, and it is the handle — not a second ✕ button in a header.
    expect(sheet.querySelectorAll('svg')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeInTheDocument()
  })

  it('still traps focus and restores it to the trigger', async () => {
    render(<Sheet initial={false} />)
    const trigger = screen.getByText('open')
    trigger.focus()
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(trigger)
  })
})
