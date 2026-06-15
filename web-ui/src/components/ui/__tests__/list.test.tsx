import { render, screen } from '@testing-library/react'
import { List, ListItem } from '../list'

describe('List', () => {
  it('renders a bordered, divided list of items', () => {
    render(
      <List aria-label="Dienste">
        <ListItem>a</ListItem>
        <ListItem>b</ListItem>
      </List>,
    )
    const list = screen.getByRole('list', { name: 'Dienste' })
    expect(list.className).toContain('divide-y')
    expect(list.className).toContain('border')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('lets a ListItem override its layout via className', () => {
    render(
      <List>
        <ListItem className="flex-wrap gap-2" data-testid="row">
          x
        </ListItem>
      </List>,
    )
    const row = screen.getByTestId('row')
    expect(row.className).toContain('flex-wrap')
    expect(row.className).toContain('px-3')
  })
})
