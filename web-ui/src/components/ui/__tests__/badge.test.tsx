import { render, screen } from '@testing-library/react'
import { Badge } from '../badge'

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge>inaktiv</Badge>)
    expect(screen.getByText('inaktiv')).toBeInTheDocument()
  })

  it('defaults to the neutral variant', () => {
    render(<Badge data-testid="b">x</Badge>)
    expect(screen.getByTestId('b').className).toContain('text-text-muted')
  })

  it('colours by semantic variant using the feedback tokens', () => {
    render(
      <Badge variant="danger" data-testid="b">
        critical
      </Badge>,
    )
    const el = screen.getByTestId('b')
    expect(el.className).toContain('text-danger')
    // Soft tint adapts to light/dark by mixing the token with the canvas.
    expect(el.className).toContain('var(--danger)')
  })

  it('merges a custom className and forwards props', () => {
    render(
      <Badge className="ml-2" title="t" data-testid="b">
        x
      </Badge>,
    )
    const el = screen.getByTestId('b')
    expect(el).toHaveClass('ml-2')
    expect(el).toHaveAttribute('title', 't')
  })
})
