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

// The panel is a Popover, so open it before reaching its controls.
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Einstellungen' }))
}

describe('SettingsMenu', () => {
  it('reflects the current order and switches it', async () => {
    const user = userEvent.setup()
    const onChangeOrder = vi.fn()
    renderMenu({ order: 'usage', onChangeOrder })
    await openMenu(user)
    expect(screen.getByRole('radio', { name: 'Nach Nutzung' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Alphabetisch' }))
    expect(onChangeOrder).toHaveBeenCalledWith('alpha')
  })

  it('toggles the separate-tab preference', async () => {
    const user = userEvent.setup()
    const onChangeSeparateTab = vi.fn()
    renderMenu({ separateTab: false, onChangeSeparateTab })
    await openMenu(user)
    const cb = screen.getByRole('checkbox', { name: /Favoriten in eigenem Tab/ })
    expect(cb).not.toBeChecked()
    await user.click(cb)
    expect(onChangeSeparateTab).toHaveBeenCalledWith(true)
  })

  it('has no axe violations when open', async () => {
    const user = userEvent.setup()
    const { container } = renderMenu()
    await openMenu(user)
    await expectNoAxeViolations(container)
  })
})
