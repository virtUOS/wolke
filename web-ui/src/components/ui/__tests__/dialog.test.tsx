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
