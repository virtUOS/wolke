import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '@/test/axe'
import { SW_NEED_REFRESH_EVENT } from '@/lib/pwa-update'

// The component's production state comes from vite-plugin-pwa's useRegisterSW.
// A jsdom test has no service worker, so the hook is mocked and its two moving
// parts — the needRefresh flag and updateServiceWorker — are driven directly.
const updateServiceWorker = vi.fn()
let needRefresh = false

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (opts?: { onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void }) => {
    registeredOpts = opts
    return {
      needRefresh: [needRefresh, vi.fn()] as [boolean, (v: boolean) => void],
      offlineReady: [false, vi.fn()] as [boolean, (v: boolean) => void],
      updateServiceWorker,
    }
  },
}))

let registeredOpts: { onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void } | undefined

// Imported after the mock is registered (vi.mock is hoisted, but keep it explicit).
const { UpdateNotice } = await import('@/components/UpdateNotice')

beforeEach(() => {
  needRefresh = false
  updateServiceWorker.mockReset()
  registeredOpts = undefined
})

function fireSeam() {
  act(() => {
    window.dispatchEvent(new CustomEvent(SW_NEED_REFRESH_EVENT))
  })
}

describe('UpdateNotice', () => {
  it('renders nothing while no update is waiting', () => {
    const { container } = render(<UpdateNotice locale="de" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the polite notice when the service worker reports an update', () => {
    needRefresh = true
    render(<UpdateNotice locale="de" />)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Neue Version verfügbar.')
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument()
  })

  it('reloads through the waiting worker when the button is clicked', async () => {
    needRefresh = true
    const user = userEvent.setup()
    render(<UpdateNotice locale="de" />)
    await user.click(screen.getByRole('button', { name: 'Neu laden' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('dismisses for this page load without persisting anything', async () => {
    needRefresh = true
    const user = userEvent.setup()
    const before = { ...window.localStorage }
    render(<UpdateNotice locale="de" />)
    await user.click(screen.getByRole('button', { name: 'Hinweis schließen' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect({ ...window.localStorage }).toEqual(before)
  })

  it('shows again when a later update is detected after a dismissal', async () => {
    const user = userEvent.setup()
    render(<UpdateNotice locale="de" />)
    fireSeam()
    await user.click(screen.getByRole('button', { name: 'Hinweis schließen' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireSeam()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders English strings for the en locale', () => {
    needRefresh = true
    render(<UpdateNotice locale="en" />)
    expect(screen.getByRole('status')).toHaveTextContent('New version available.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('is axe clean while shown', async () => {
    needRefresh = true
    const { baseElement } = render(<UpdateNotice locale="de" />)
    await expectNoAxeViolations(baseElement, ['region'])
  })

  describe('the e2e seam', () => {
    it('shows the same notice on the wolke:sw-need-refresh event', () => {
      render(<UpdateNotice locale="de" />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      fireSeam()
      expect(screen.getByRole('status')).toHaveTextContent('Neue Version verfügbar.')
    })

    it('falls back to a plain reload when no worker is waiting', async () => {
      const reload = vi.fn()
      vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
      const user = userEvent.setup()
      render(<UpdateNotice locale="de" />)
      fireSeam()
      await user.click(screen.getByRole('button', { name: 'Neu laden' }))
      expect(updateServiceWorker).not.toHaveBeenCalled()
      expect(reload).toHaveBeenCalled()
      vi.restoreAllMocks()
    })
  })

  it('starts update checks for the registration the hook reports', () => {
    render(<UpdateNotice locale="de" />)
    expect(registeredOpts?.onRegisteredSW).toBeTypeOf('function')
  })
})
