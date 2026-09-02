import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { Checkbox } from '../checkbox'
import { expectNoAxeViolations } from '@/test/axe'

describe('Checkbox', () => {
  it('is labelled by its own label and toggles on click', async () => {
    const onChange = vi.fn()
    render(<Checkbox label="Ausblendbar" checked={false} onChange={onChange} />)
    const box = screen.getByRole('checkbox', { name: 'Ausblendbar' })
    await userEvent.click(box)
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('is keyboard-operable and reflects the checked state', async () => {
    render(<Checkbox label="Ausblendbar" defaultChecked />)
    const box = screen.getByRole('checkbox', { name: 'Ausblendbar' })
    expect(box).toBeChecked()
    box.focus()
    await userEvent.keyboard(' ')
    expect(box).not.toBeChecked()
  })

  // The 16px box can never be a 44px target on its own, so the label around it
  // is the hit area (issue #101) — the same padded-click-target shape the
  // viewport suite measures.
  it('makes the label the touch target, compact from md: up', () => {
    render(<Checkbox label="Ausblendbar" />)
    const label = screen.getByText('Ausblendbar')
    expect(label.className).toContain('min-h-11')
    expect(label.className).toContain('md:min-h-0')
  })

  it('forwards props and a ref, and merges className onto the box', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox label="x" className="mt-1" name="dismissible" ref={ref} />)
    const box = screen.getByRole('checkbox', { name: 'x' })
    expect(box).toHaveClass('mt-1')
    expect(box).toHaveAttribute('name', 'dismissible')
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it('has no axe violations', async () => {
    const { container } = render(<Checkbox label="Ausblendbar" />)
    await expectNoAxeViolations(container)
  })
})
