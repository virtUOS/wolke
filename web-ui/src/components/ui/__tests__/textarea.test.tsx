import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from '../textarea'

describe('Textarea', () => {
  it('accepts multi-line input', async () => {
    render(<Textarea aria-label="Beschreibung" rows={2} />)
    const el = screen.getByLabelText('Beschreibung')
    await userEvent.type(el, 'zeile')
    expect(el).toHaveValue('zeile')
  })

  it('signals an invalid state and merges className', () => {
    render(<Textarea aria-label="x" aria-invalid className="mt-1" />)
    const el = screen.getByLabelText('x')
    expect(el).toHaveAttribute('aria-invalid', 'true')
    expect(el).toHaveClass('mt-1')
  })
})
