import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { Input } from '../input'

describe('Input', () => {
  it('accepts typed text', async () => {
    render(<Input aria-label="Titel" />)
    const el = screen.getByLabelText('Titel')
    await userEvent.type(el, 'hi')
    expect(el).toHaveValue('hi')
  })

  it('signals an invalid state for aria-invalid', () => {
    render(<Input aria-label="x" aria-invalid />)
    const el = screen.getByLabelText('x')
    expect(el).toHaveAttribute('aria-invalid', 'true')
    expect(el.className).toContain('aria-[invalid=true]:border-danger')
  })

  it('merges className and forwards props + ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input aria-label="x" className="mt-1" placeholder="p" ref={ref} />)
    const el = screen.getByLabelText('x')
    expect(el).toHaveClass('mt-1')
    expect(el).toHaveAttribute('placeholder', 'p')
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })
})
