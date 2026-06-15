import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Info } from 'lucide-react'
import { Alert } from '../alert'

describe('Alert', () => {
  it('renders title and body', () => {
    render(
      <Alert title="Wartung">
        Heute Abend.
      </Alert>,
    )
    expect(screen.getByText('Wartung')).toBeInTheDocument()
    expect(screen.getByText('Heute Abend.')).toBeInTheDocument()
  })

  it('tints by variant', () => {
    render(
      <Alert variant="danger" data-testid="a">
        x
      </Alert>,
    )
    expect(screen.getByTestId('a').className).toContain('border-danger')
  })

  it('shows a dismiss control with an accessible name and fires onDismiss', async () => {
    const onDismiss = vi.fn()
    render(
      <Alert icon={<Info aria-hidden="true" />} title="t" onDismiss={onDismiss} dismissLabel="Schließen">
        body
      </Alert>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('omits the dismiss control when onDismiss is absent', () => {
    render(<Alert title="t">body</Alert>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
