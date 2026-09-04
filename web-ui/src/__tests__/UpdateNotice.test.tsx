import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '@/test/axe'
import { RELOAD_FALLBACK_MS, SW_NEED_REFRESH_EVENT } from '@/lib/pwa-update'

// The component's production state comes from vite-plugin-pwa's useRegisterSW.
// A jsdom test has no service worker, so the hook is mocked and its moving
// parts — the callbacks it invokes and updateServiceWorker — are driven
// directly. `updateServiceWorker` resolves but never reloads: that is exactly
// the uncontrolled desktop tab of issue #120, where the worker's own
// controllerchange reload never arrives.
const updateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>()

type Opts = {
  onNeedRefresh?: () => void
  onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void
}
let registeredOpts: Opts | undefined

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (opts?: Opts) => {
    registeredOpts = opts
    return {
      needRefresh: [false, vi.fn()] as [boolean, (v: boolean) => void],
      offlineReady: [false, vi.fn()] as [boolean, (v: boolean) => void],
      updateServiceWorker,
    }
  },
}))

// The periodic update check is its own unit (pwa-update.test.ts); here only the
// wiring matters, so it is stubbed to hand back an observable teardown.
const stopChecks = vi.fn()
const startUpdateChecks = vi.fn(() => stopChecks)
vi.mock('@/lib/pwa-update', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pwa-update')>()
  return { ...actual, startUpdateChecks: () => startUpdateChecks() }
})

// Imported after the mock is registered (vi.mock is hoisted, but keep it explicit).
const { UpdateNotice } = await import('@/components/UpdateNotice')

beforeEach(() => {
  updateServiceWorker.mockReset()
  updateServiceWorker.mockResolvedValue(undefined)
  startUpdateChecks.mockReset()
  startUpdateChecks.mockReturnValue(stopChecks)
  stopChecks.mockReset()
  registeredOpts = undefined
})

/** A new deploy's worker has installed and is waiting. */
function fireNeedRefresh() {
  act(() => {
    registeredOpts?.onNeedRefresh?.()
  })
}

/** The e2e seam: the notice with no waiting worker behind it. */
function fireSeam() {
  act(() => {
    window.dispatchEvent(new CustomEvent(SW_NEED_REFRESH_EVENT))
  })
}

/** Replaces window.location.reload for the duration of one test. */
function stubReload() {
  const reload = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
  return reload
}

const reloadButton = () => screen.getByRole('button', { name: 'Neu laden' })

afterEach(() => vi.restoreAllMocks())

describe('UpdateNotice', () => {
  it('renders nothing while no update is waiting', () => {
    const { container } = render(<UpdateNotice locale="de" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the polite notice when the service worker reports an update', () => {
    render(<UpdateNotice locale="de" />)
    fireNeedRefresh()
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Neue Version verfügbar.')
    expect(reloadButton()).toBeInTheDocument()
  })

  it('applies the waiting worker when the button is clicked', async () => {
    const user = userEvent.setup()
    render(<UpdateNotice locale="de" />)
    fireNeedRefresh()
    await user.click(reloadButton())
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('dismisses for this page load without persisting anything', async () => {
    const user = userEvent.setup()
    const before = { ...window.localStorage }
    render(<UpdateNotice locale="de" />)
    fireNeedRefresh()
    await user.click(screen.getByRole('button', { name: 'Hinweis schließen' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect({ ...window.localStorage }).toEqual(before)
  })

  it('shows again when a later deploy is detected after a dismissal', async () => {
    // The #95 review nit: a dismissal must not silence the *next* deploy in a
    // long-lived tab. The hook's needRefresh flag is already true by then, so
    // the notice counts the reports instead of reading the flag.
    const user = userEvent.setup()
    render(<UpdateNotice locale="de" />)
    fireNeedRefresh()
    await user.click(screen.getByRole('button', { name: 'Hinweis schließen' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireNeedRefresh()
    expect(screen.getByRole('status')).toHaveTextContent('Neue Version verfügbar.')
  })

  it('renders English strings for the en locale', () => {
    render(<UpdateNotice locale="en" />)
    fireNeedRefresh()
    expect(screen.getByRole('status')).toHaveTextContent('New version available.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('is axe clean while shown', async () => {
    const { baseElement } = render(<UpdateNotice locale="de" />)
    fireNeedRefresh()
    await expectNoAxeViolations(baseElement, ['region'])
  })

  // Issue #120: on a desktop tab the page is regularly uncontrolled, so the
  // service worker's own controllerchange reload never fires and the click used
  // to do nothing at all.
  describe('the click always acts (issue #120)', () => {
    it('reloads the page itself when the worker never takes it away', () => {
      vi.useFakeTimers()
      try {
        const reload = stubReload()
        render(<UpdateNotice locale="de" />)
        fireNeedRefresh()
        fireEvent.click(reloadButton())

        expect(updateServiceWorker).toHaveBeenCalledWith(true)
        expect(reload).not.toHaveBeenCalled()

        act(() => {
          vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1)
        })
        expect(reload).not.toHaveBeenCalled()
        act(() => {
          vi.advanceTimersByTime(1)
        })
        expect(reload).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('still reloads when applying the update rejects', () => {
      vi.useFakeTimers()
      try {
        updateServiceWorker.mockRejectedValue(new Error('no worker'))
        const reload = stubReload()
        render(<UpdateNotice locale="de" />)
        fireNeedRefresh()
        fireEvent.click(reloadButton())

        act(() => {
          vi.advanceTimersByTime(RELOAD_FALLBACK_MS)
        })
        expect(reload).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('disables the button while the reload is in flight, so clicks cannot race', () => {
      vi.useFakeTimers()
      try {
        const reload = stubReload()
        render(<UpdateNotice locale="de" />)
        fireNeedRefresh()
        fireEvent.click(reloadButton())
        expect(reloadButton()).toBeDisabled()

        // A second click (a double-click, an impatient user) must not send a
        // second skip-waiting message or arm a second reload.
        fireEvent.click(reloadButton())
        expect(updateServiceWorker).toHaveBeenCalledTimes(1)

        act(() => {
          vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 2)
        })
        expect(reload).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('drops a pending fallback reload when the notice unmounts', () => {
      vi.useFakeTimers()
      try {
        const reload = stubReload()
        const { unmount } = render(<UpdateNotice locale="de" />)
        fireNeedRefresh()
        fireEvent.click(reloadButton())
        unmount()

        act(() => {
          vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 2)
        })
        expect(reload).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('the e2e seam', () => {
    it('shows the same notice on the wolke:sw-need-refresh event', () => {
      render(<UpdateNotice locale="de" />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      fireSeam()
      expect(screen.getByRole('status')).toHaveTextContent('Neue Version verfügbar.')
    })

    it('falls back to a plain reload when no worker is waiting', async () => {
      const reload = stubReload()
      const user = userEvent.setup()
      render(<UpdateNotice locale="de" />)
      fireSeam()
      await user.click(reloadButton())
      expect(updateServiceWorker).not.toHaveBeenCalled()
      expect(reload).toHaveBeenCalled()
    })

    it('re-shows after a dismissal, like a real later update', async () => {
      const user = userEvent.setup()
      render(<UpdateNotice locale="de" />)
      fireSeam()
      await user.click(screen.getByRole('button', { name: 'Hinweis schließen' }))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      fireSeam()
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  describe('the periodic update check', () => {
    it('starts for the registration the hook reports', () => {
      render(<UpdateNotice locale="de" />)
      expect(registeredOpts?.onRegisteredSW).toBeTypeOf('function')
      act(() => {
        registeredOpts?.onRegisteredSW?.('/sw.js', {} as ServiceWorkerRegistration)
      })
      expect(startUpdateChecks).toHaveBeenCalledTimes(1)
    })

    it('does nothing when registration failed and none is reported', () => {
      render(<UpdateNotice locale="de" />)
      act(() => {
        registeredOpts?.onRegisteredSW?.('/sw.js', undefined)
      })
      expect(startUpdateChecks).not.toHaveBeenCalled()
    })

    it('tears down the previous checks when a registration is reported twice', () => {
      // The #95 review nit: the teardown startUpdateChecks returns used to be
      // discarded, so a second report left an orphaned interval and
      // visibilitychange listener polling forever.
      render(<UpdateNotice locale="de" />)
      act(() => {
        registeredOpts?.onRegisteredSW?.('/sw.js', {} as ServiceWorkerRegistration)
      })
      expect(stopChecks).not.toHaveBeenCalled()
      act(() => {
        registeredOpts?.onRegisteredSW?.('/sw.js', {} as ServiceWorkerRegistration)
      })
      expect(stopChecks).toHaveBeenCalledTimes(1)
      expect(startUpdateChecks).toHaveBeenCalledTimes(2)
    })

    it('stops the checks when the notice unmounts', () => {
      const { unmount } = render(<UpdateNotice locale="de" />)
      act(() => {
        registeredOpts?.onRegisteredSW?.('/sw.js', {} as ServiceWorkerRegistration)
      })
      unmount()
      expect(stopChecks).toHaveBeenCalledTimes(1)
    })
  })
})
