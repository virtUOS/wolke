import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from 'lucide-react'
import { Popover } from '../popover'

function renderPopover() {
  return render(
    <div>
      <button>outside</button>
      <Popover label="Einstellungen" icon={<Settings aria-hidden="true" />}>
        <p>panel body</p>
      </Popover>
    </div>,
  )
}

describe('Popover', () => {
  it('is closed until the trigger is activated', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: 'Einstellungen' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Einstellungen' })).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: 'Einstellungen' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on an outside click', async () => {
    renderPopover()
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByText('outside'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
