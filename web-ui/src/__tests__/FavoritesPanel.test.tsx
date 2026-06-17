import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavoritesSection } from '@/components/FavoritesPanel'
import type { Category, Service } from '@/lib/api'
import { expectNoAxeViolations } from '@/test/axe'

const categories: Category[] = [{ slug: 'data', label: { de: 'Netz & Daten' }, sort: 10 }]
const myShare: Service = {
  id: 's1',
  name: 'MyShare',
  description: { de: 'Netzspeicher.' },
  service_url: 'https://myshare.example.edu',
  icon: 'hard-drive',
  categories: ['data'],
  doc_only: false,
}

function renderSection(overrides: Partial<React.ComponentProps<typeof FavoritesSection>> = {}) {
  const props: React.ComponentProps<typeof FavoritesSection> = {
    favorites: [myShare],
    categories,
    locale: 'de',
    layout: 'grid',
    actions: { favoritedIDs: new Set(['s1']), onToggleFavorite: vi.fn(), onLaunch: vi.fn() },
    ...overrides,
  }
  return { props, ...render(<FavoritesSection {...props} />) }
}

describe('FavoritesSection', () => {
  it('renders the "Deine Favoriten" heading and the favorited services', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Deine Favoriten' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /MyShare/ })).toBeInTheDocument()
  })

  it('shows an empty hint when there are no favorites', () => {
    renderSection({ favorites: [] })
    expect(screen.getByText(/Noch nichts gemerkt/)).toBeInTheDocument()
  })

  it('un-favorites via the star', async () => {
    const user = userEvent.setup()
    const onToggleFavorite = vi.fn()
    renderSection({ actions: { favoritedIDs: new Set(['s1']), onToggleFavorite, onLaunch: vi.fn() } })
    await user.click(screen.getByRole('button', { name: /aus Favoriten entfernen/ }))
    expect(onToggleFavorite).toHaveBeenCalledWith(myShare)
  })

  it('has no axe violations', async () => {
    const { container } = renderSection()
    await expectNoAxeViolations(container)
  })
})
