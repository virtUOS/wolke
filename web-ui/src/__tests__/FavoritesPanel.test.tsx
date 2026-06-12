import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavoritesPanel } from '@/components/FavoritesPanel'
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

function renderPanel(overrides: Partial<React.ComponentProps<typeof FavoritesPanel>> = {}) {
  const props: React.ComponentProps<typeof FavoritesPanel> = {
    favorites: [myShare],
    frequent: [myShare],
    categories,
    locale: 'de',
    view: 'list',
    actions: {
      favoritedIDs: new Set(['s1']),
      onToggleFavorite: vi.fn(),
      onLaunch: vi.fn(),
    },
    ...overrides,
  }
  return { props, ...render(<FavoritesPanel {...props} />) }
}

describe('FavoritesPanel', () => {
  it('renders the frequently-used strip and the favorites section', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Häufig genutzt' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Favoriten' })).toBeInTheDocument()
    // MyShare appears in both the frequent strip and the favorites grid.
    expect(screen.getAllByRole('link', { name: /MyShare/ }).length).toBeGreaterThanOrEqual(2)
  })

  it('shows an empty hint when there are no favorites', () => {
    renderPanel({ favorites: [] })
    expect(screen.getByText(/Noch nichts gemerkt/)).toBeInTheDocument()
  })

  it('un-favorites via the star', async () => {
    const user = userEvent.setup()
    const onToggleFavorite = vi.fn()
    renderPanel({ frequent: [], actions: { favoritedIDs: new Set(['s1']), onToggleFavorite, onLaunch: vi.fn() } })
    await user.click(screen.getByRole('button', { name: /aus Favoriten entfernen/ }))
    expect(onToggleFavorite).toHaveBeenCalledWith(myShare)
  })

  it('has no axe violations', async () => {
    const { container } = renderPanel()
    await expectNoAxeViolations(container)
  })
})
