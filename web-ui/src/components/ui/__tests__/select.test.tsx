import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { Select } from '../select'

describe('Select', () => {
  it('renders options and changes selection', async () => {
    render(
      <Select aria-label="Schweregrad" defaultValue="info">
        <option value="info">info</option>
        <option value="warning">warning</option>
      </Select>,
    )
    const el = screen.getByLabelText<HTMLSelectElement>('Schweregrad')
    await userEvent.selectOptions(el, 'warning')
    expect(el.value).toBe('warning')
  })

  it('signals an invalid state and forwards className + ref', () => {
    const ref = createRef<HTMLSelectElement>()
    render(
      <Select aria-label="x" aria-invalid className="w-full" ref={ref}>
        <option>a</option>
      </Select>,
    )
    const el = screen.getByLabelText('x')
    expect(el).toHaveAttribute('aria-invalid', 'true')
    expect(el).toHaveClass('w-full')
    expect(ref.current).toBeInstanceOf(HTMLSelectElement)
  })
})
