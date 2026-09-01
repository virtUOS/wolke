import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChoiceChip } from '../choice-chip'
import { expectNoAxeViolations } from '@/test/axe'

describe('ChoiceChip', () => {
  it('is a real checkbox, labelled by the chip', async () => {
    const onChange = vi.fn()
    render(<ChoiceChip type="checkbox" label="Lernmanagement" checked={false} onChange={onChange} />)
    const box = screen.getByRole('checkbox', { name: 'Lernmanagement' })
    await userEvent.click(box)
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('is a real radio when asked, and keyboard-operable', async () => {
    render(
      <>
        <ChoiceChip type="radio" name="tag" value="" label="Keins" defaultChecked />
        <ChoiceChip type="radio" name="tag" value="beta" label="Beta" />
      </>,
    )
    const beta = screen.getByRole('radio', { name: 'Beta' })
    screen.getByRole('radio', { name: 'Keins' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(beta).toBeChecked()
  })

  it('shows its active state and keeps the floor on the chip, compact from md: up', () => {
    render(<ChoiceChip type="checkbox" label="Lehre" active />)
    const chip = screen.getByText('Lehre')
    expect(chip.className).toContain('bg-primary')
    expect(chip.className).toContain('min-h-11')
    expect(chip.className).toContain('md:min-h-0')
  })

  it('merges className onto the chip and forwards a ref to the control', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(<ChoiceChip type="checkbox" label="Lehre" className="mt-1" ref={ref} />)
    expect(screen.getByText('Lehre')).toHaveClass('mt-1')
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it('has no axe violations', async () => {
    const { container } = render(<ChoiceChip type="checkbox" label="Lehre" />)
    await expectNoAxeViolations(container)
  })
})
