import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PillButton } from '../pill-button'

describe('PillButton', () => {
  it('shows the active fill only when active', () => {
    const { rerender } = render(<PillButton>Dienste</PillButton>)
    expect(screen.getByRole('button').className).not.toContain('bg-primary')
    rerender(<PillButton active>Dienste</PillButton>)
    expect(screen.getByRole('button').className).toContain('bg-primary')
  })

  it('leaves ARIA semantics to the caller and fires onClick', async () => {
    const onClick = vi.fn()
    render(
      <PillButton active aria-current="page" onClick={onClick}>
        Favoriten
      </PillButton>,
    )
    const btn = screen.getByRole('button', { name: 'Favoriten' })
    expect(btn).toHaveAttribute('aria-current', 'page')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
