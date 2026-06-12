import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tile } from '@/components/Tile'
import type { Category, Service } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const categories: Category[] = [
  { slug: 'data', label: { de: 'Netz & Daten', en: 'Network & Data' }, sort: 10 },
]

const service: Service = {
  id: 's1',
  name: 'MyShare',
  description: { de: 'Persönlicher Netzspeicher.', en: 'Your storage.' },
  service_url: 'https://myshare.example.edu',
  doc_url: 'https://docs.example.edu/myshare',
  icon: 'hard-drive',
  categories: ['data'],
  doc_only: false,
}

const docOnly: Service = {
  id: 's2',
  name: 'WLAN an der UOS',
  description: { de: 'So verbindest du dich.', en: 'How to connect.' },
  doc_url: 'https://docs.example.edu/wifi',
  icon: 'wifi',
  categories: ['data'],
  doc_only: true,
}

describe('Tile', () => {
  it('top zone is a launch link opening the service in a new tab', () => {
    render(<Tile service={service} categories={categories} locale="de" />)
    const link = screen.getByRole('link', { name: /MyShare/ })
    expect(link).toHaveAttribute('href', 'https://myshare.example.edu')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('bottom zone toggles the description in place and never navigates', async () => {
    const user = userEvent.setup()
    render(<Tile service={service} categories={categories} locale="de" />)
    const expander = screen.getByRole('button', { name: /Mehr Details/ })
    expect(expander).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Persönlicher Netzspeicher.')).not.toBeInTheDocument()

    await user.click(expander)
    expect(screen.getByRole('button', { name: /Weniger Details/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Persönlicher Netzspeicher.')).toBeInTheDocument()
    // The documentation link appears in the expanded region.
    expect(screen.getByRole('link', { name: /Dokumentation/ })).toHaveAttribute('href', 'https://docs.example.edu/myshare')
  })

  it('a doc-only entry launches its documentation and is marked informational', () => {
    render(<Tile service={docOnly} categories={categories} locale="de" />)
    const link = screen.getByRole('link', { name: /WLAN an der UOS/ })
    expect(link).toHaveAttribute('href', 'https://docs.example.edu/wifi')
    expect(screen.getByLabelText('Nur Dokumentation')).toBeInTheDocument()
  })

  it('shows the favorite star only when a handler is provided, with aria-pressed', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const { rerender } = render(<Tile service={service} categories={categories} locale="de" />)
    expect(screen.queryByRole('button', { name: /Favoriten/ })).not.toBeInTheDocument()

    rerender(<Tile service={service} categories={categories} locale="de" favorited={false} onToggleFavorite={onToggle} />)
    const star = screen.getByRole('button', { name: /zu Favoriten hinzufügen/ })
    expect(star).toHaveAttribute('aria-pressed', 'false')
    await user.click(star)
    expect(onToggle).toHaveBeenCalledWith(service)
  })

  it('fires onLaunch when the launch zone is activated', async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn()
    render(<Tile service={service} categories={categories} locale="de" onLaunch={onLaunch} />)
    await user.click(screen.getByRole('link', { name: /MyShare/ }))
    expect(onLaunch).toHaveBeenCalledWith(service)
  })

  it('shows an add-to-list button when onAddToList is provided', async () => {
    const user = userEvent.setup()
    const onAddToList = vi.fn()
    render(<Tile service={service} categories={categories} locale="de" onAddToList={onAddToList} />)
    await user.click(screen.getByRole('button', { name: /zu einer Liste hinzufügen/ }))
    expect(onAddToList).toHaveBeenCalledWith(service)
  })

  it('has no axe violations with all controls', async () => {
    const { container } = render(
      <Tile service={service} categories={categories} locale="de" onToggleFavorite={() => {}} onAddToList={() => {}} onLaunch={() => {}} />,
    )
    await expectNoAxeViolations(container)
  })
})
