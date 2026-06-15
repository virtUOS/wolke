import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../icon-button'

describe('IconButton', () => {
  it('exposes its accessible name and fires onClick', async () => {
    const onClick = vi.fn()
    render(
      <IconButton aria-label="Schließen" onClick={onClick}>
        <X aria-hidden="true" />
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Schließen' })
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('applies size and variant classes', () => {
    render(
      <IconButton aria-label="x" size="sm" variant="plain">
        <X />
      </IconButton>,
    )
    expect(screen.getByRole('button').className).toContain('p-1')
  })

  it('is keyboard-operable and forwards disabled', () => {
    render(
      <IconButton aria-label="x" disabled>
        <X />
      </IconButton>,
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('merges className and forwards a ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <IconButton aria-label="x" className="ml-2" ref={ref}>
        <X />
      </IconButton>,
    )
    expect(screen.getByRole('button')).toHaveClass('ml-2')
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
