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
  it('tile is a launch link opening the service in a new tab', () => {
    render(<Tile service={service} categories={categories} locale="de" />)
    const link = screen.getByRole('link', { name: /MyShare/ })
    expect(link).toHaveAttribute('href', 'https://myshare.example.edu')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('description is always visible and documentation link is in the footer', () => {
    render(<Tile service={service} categories={categories} locale="de" />)
    expect(screen.getByText('Persönlicher Netzspeicher.')).toBeInTheDocument()
    const docsLink = screen.getByRole('link', { name: /Doku/ })
    expect(docsLink).toHaveAttribute('href', 'https://docs.example.edu/myshare')
  })

  it('a doc-only entry launches its documentation and shows the Dokumentation badge', () => {
    render(<Tile service={docOnly} categories={categories} locale="de" />)
    const link = screen.getByRole('link', { name: /WLAN an der UOS/ })
    expect(link).toHaveAttribute('href', 'https://docs.example.edu/wifi')
    expect(screen.getByText('Dokumentation')).toBeInTheDocument()
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

  it('fires onLaunch when the launch link is activated', async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn()
    render(<Tile service={service} categories={categories} locale="de" onLaunch={onLaunch} />)
    await user.click(screen.getByRole('link', { name: /MyShare/ }))
    expect(onLaunch).toHaveBeenCalledWith(service)
  })

  it('has no axe violations with all controls', async () => {
    const { container } = render(
      <Tile service={service} categories={categories} locale="de" onToggleFavorite={() => {}} onLaunch={() => {}} />,
    )
    await expectNoAxeViolations(container)
  })
})
