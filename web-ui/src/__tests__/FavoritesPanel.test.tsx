import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavoritesPanel } from '@/components/FavoritesPanel'
import type { Category, FavoriteList, Service } from '@/lib/api'
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
const lists: FavoriteList[] = [
  { id: 'l1', name: 'Täglich', is_default: true, sort: 0, items: ['s1'] },
  { id: 'l2', name: 'Wichtig', is_default: false, sort: 1, items: [] },
]

function renderPanel(overrides: Partial<React.ComponentProps<typeof FavoritesPanel>> = {}) {
  const props: React.ComponentProps<typeof FavoritesPanel> = {
    lists,
    frequent: [myShare],
    resolve: (id) => (id === 's1' ? myShare : undefined),
    categories,
    locale: 'de',
    view: 'list',
    defaultListID: 'l1',
    favoritedIDs: new Set(['s1']),
    onCreateList: vi.fn(),
    onRenameList: vi.fn(),
    onDeleteList: vi.fn(),
    onReorderList: vi.fn(),
    onRemoveItem: vi.fn(),
    onToggleFavorite: vi.fn(),
    onAddToList: vi.fn(),
    onLaunch: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<FavoritesPanel {...props} />) }
}

describe('FavoritesPanel', () => {
  it('renders the frequently-used strip and each list with its items', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Häufig genutzt' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Täglich' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Wichtig' })).toBeInTheDocument()
    expect(screen.getByText('Diese Liste ist leer.')).toBeInTheDocument() // the empty "Wichtig"
  })

  it('creates a list via the inline form', async () => {
    const user = userEvent.setup()
    const onCreateList = vi.fn()
    renderPanel({ onCreateList })
    await user.type(screen.getByLabelText('Name der neuen Liste'), 'Studium')
    await user.click(screen.getByRole('button', { name: 'Liste erstellen' }))
    expect(onCreateList).toHaveBeenCalledWith('Studium')
  })

  it('removes an item from a specific list', async () => {
    const user = userEvent.setup()
    const onRemoveItem = vi.fn()
    renderPanel({ onRemoveItem })
    await user.click(screen.getByRole('button', { name: /Aus „Täglich" entfernen/ }))
    expect(onRemoveItem).toHaveBeenCalledWith('l1', 's1')
  })

  it('has no axe violations', async () => {
    const { container } = renderPanel()
    await expectNoAxeViolations(container)
  })
})
