import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsMenu } from '@/components/SettingsMenu'
import { expectNoAxeViolations } from '@/test/axe'

function renderMenu(overrides: Partial<React.ComponentProps<typeof SettingsMenu>> = {}) {
  const props: React.ComponentProps<typeof SettingsMenu> = {
    order: 'usage',
    separateTab: false,
    onChangeOrder: vi.fn(),
    onChangeSeparateTab: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<SettingsMenu {...props} />) }
}

describe('SettingsMenu', () => {
  it('reflects the current order and switches it', async () => {
    const user = userEvent.setup()
    const onChangeOrder = vi.fn()
    renderMenu({ order: 'usage', onChangeOrder })
    expect(screen.getByRole('radio', { name: 'Nach Nutzung' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Alphabetisch' }))
    expect(onChangeOrder).toHaveBeenCalledWith('alpha')
  })

  it('toggles the separate-tab preference', async () => {
    const user = userEvent.setup()
    const onChangeSeparateTab = vi.fn()
    renderMenu({ separateTab: false, onChangeSeparateTab })
    const cb = screen.getByRole('checkbox', { name: /Favoriten in eigenem Tab/ })
    expect(cb).not.toBeChecked()
    await user.click(cb)
    expect(onChangeSeparateTab).toHaveBeenCalledWith(true)
  })

  it('has no axe violations', async () => {
    const { container } = renderMenu()
    await expectNoAxeViolations(container)
  })
})
