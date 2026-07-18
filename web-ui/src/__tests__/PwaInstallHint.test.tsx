import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PwaInstallHint } from '@/components/PwaInstallHint'
import * as pwa from '@/lib/pwa-install'
import { expectNoAxeViolations } from '@/test/axe'

// The hint reads installability via the store's getInstallHintState; tests pin
// each UI variant by mocking the state instead of stubbing browser events.
function mockState(state: pwa.InstallHintState) {
  vi.spyOn(pwa, 'getInstallHintState').mockReturnValue(state)
}

afterEach(() => vi.restoreAllMocks())

describe('PwaInstallHint', () => {
  it('renders nothing when hidden or on desktop', () => {
    mockState('hidden')
    const { container } = render(<PwaInstallHint isMobile locale="de" />)
    expect(container).toBeEmptyDOMElement()

    mockState('installable')
    const { container: desktop } = render(<PwaInstallHint isMobile={false} locale="de" />)
    expect(desktop).toBeEmptyDOMElement()
  })

  it('renders the actionable variant with an install button (Chromium)', async () => {
    mockState('installable')
    const prompt = vi.spyOn(pwa, 'promptInstall').mockResolvedValue()
    const user = userEvent.setup()
    const { baseElement } = render(<PwaInstallHint isMobile locale="de" />)

    expect(screen.getByRole('region', { name: 'App-Installation' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Installieren' }))
    expect(prompt).toHaveBeenCalled()
    await expectNoAxeViolations(baseElement, ['region'])
  })

  it('renders share-sheet instructions without a button on iOS', () => {
    mockState('ios')
    render(<PwaInstallHint isMobile locale="en" />)
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
  })

  it('dismisses via the close control', async () => {
    mockState('installable')
    const dismiss = vi.spyOn(pwa, 'dismissInstallHint').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<PwaInstallHint isMobile locale="de" />)
    await user.click(screen.getByRole('button', { name: 'Hinweis schließen' }))
    expect(dismiss).toHaveBeenCalled()
  })
})

describe('dismissInstallHint persistence', () => {
  it('persists the flag in localStorage and survives a re-read', () => {
    window.localStorage.removeItem('wolke:install-hint-dismissed')
    pwa.dismissInstallHint()
    expect(window.localStorage.getItem('wolke:install-hint-dismissed')).toBe('1')
  })
})
