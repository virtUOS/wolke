import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Card } from '../card'

describe('Card', () => {
  it('renders its children inside a bordered surface', () => {
    render(<Card>hello</Card>)
    const el = screen.getByText('hello')
    expect(el).toHaveClass('border', 'rounded-lg')
  })

  it('applies padding and elevation variants', () => {
    render(
      <Card padding="md" elevation="sm" data-testid="c">
        x
      </Card>,
    )
    const el = screen.getByTestId('c')
    expect(el.className).toContain('p-4')
    expect(el.className).toContain('shadow-sm')
  })

  it('adds a hover-elevation transition when interactive', () => {
    render(
      <Card interactive data-testid="c">
        x
      </Card>,
    )
    expect(screen.getByTestId('c').className).toContain('hover:shadow-md')
  })

  it('merges a custom className and forwards arbitrary props', () => {
    render(
      <Card className="mt-2" aria-label="panel" data-testid="c">
        x
      </Card>,
    )
    const el = screen.getByTestId('c')
    expect(el).toHaveClass('mt-2')
    expect(el).toHaveAttribute('aria-label', 'panel')
  })

  it('forwards a ref to the underlying element', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Card ref={ref}>x</Card>)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })
})
