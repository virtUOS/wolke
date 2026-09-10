import {
  PRELOAD_ERROR_EVENT,
  RELOAD_FALLBACK_MS,
  STALE_SHELL_RELOAD_KEY,
  STALE_WORKER_WAIT_MS,
  UPDATE_POLL_INTERVAL_MS,
  applyUpdate,
  declineStaleShellEscape,
  provideStaleShellEscape,
  startStaleShellRecovery,
  startUpdateChecks,
} from '@/lib/pwa-update'

// A long-lived tab (or an installed PWA resuming from the background) must be
// told about a new deploy: the registration is polled on an interval and
// re-checked whenever the document becomes visible again.
function fakeRegistration() {
  return { update: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceWorkerRegistration & {
    update: ReturnType<typeof vi.fn>
  }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

let stop: (() => void) | undefined

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  setVisibility('visible')
})

describe('startUpdateChecks', () => {
  it('polls the registration once per interval', () => {
    const reg = fakeRegistration()
    stop = startUpdateChecks(reg)
    expect(reg.update).not.toHaveBeenCalled()

    vi.advanceTimersByTime(UPDATE_POLL_INTERVAL_MS)
    expect(reg.update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_POLL_INTERVAL_MS)
    expect(reg.update).toHaveBeenCalledTimes(2)
  })

  it('checks when the document becomes visible again', () => {
    const reg = fakeRegistration()
    stop = startUpdateChecks(reg)

    setVisibility('hidden')
    expect(reg.update).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('stops polling and listening once torn down', () => {
    const reg = fakeRegistration()
    startUpdateChecks(reg)()

    vi.advanceTimersByTime(UPDATE_POLL_INTERVAL_MS * 3)
    setVisibility('hidden')
    setVisibility('visible')
    expect(reg.update).not.toHaveBeenCalled()
  })

  it('survives a rejected update check (offline, server down)', async () => {
    const reg = fakeRegistration()
    reg.update.mockRejectedValue(new Error('offline'))
    stop = startUpdateChecks(reg)

    vi.advanceTimersByTime(UPDATE_POLL_INTERVAL_MS)
    // Flush the rejected promise: an unhandled rejection here would fail the run.
    await Promise.resolve()
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('polls hourly — long enough to be invisible, short enough that a deploy lands', () => {
    expect(UPDATE_POLL_INTERVAL_MS).toBe(60 * 60 * 1000)
  })
})

// Applying a waiting worker has to end in a navigation even when the worker's
// own controllerchange reload never comes — the uncontrolled desktop tab of
// issue #120.
describe('applyUpdate', () => {
  function stubReload() {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    return reload
  }

  afterEach(() => vi.restoreAllMocks())

  it('tells the worker to skip waiting and reloads if it never does', () => {
    const reload = stubReload()
    const updateServiceWorker = vi.fn().mockResolvedValue(undefined)

    applyUpdate(updateServiceWorker)
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(reload).not.toHaveBeenCalled()

    vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads once, not repeatedly', () => {
    const reload = stubReload()
    applyUpdate(vi.fn().mockResolvedValue(undefined))
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 5)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('arms the reload even if messaging the worker throws', () => {
    const reload = stubReload()
    // Armed before the worker is messaged, so a synchronous failure in
    // vite-plugin-pwa's register plumbing cannot swallow the click.
    expect(() =>
      applyUpdate(() => {
        throw new Error('registration gone')
      }),
    ).toThrow()
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('survives a rejected update and still reloads', async () => {
    const reload = stubReload()
    applyUpdate(vi.fn().mockRejectedValue(new Error('offline')))
    // Flush the rejection: an unhandled one here would fail the run.
    await Promise.resolve()
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('the canceller drops the pending reload', () => {
    const reload = stubReload()
    applyUpdate(vi.fn().mockResolvedValue(undefined))()
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits 1.5s — long enough for the handoff, short enough to feel like a click', () => {
    expect(RELOAD_FALLBACK_MS).toBe(1500)
  })
})

// The other half of issue #150, corrected by issue #158: a client holding a
// stale index.html asks for a hashed chunk the deploy no longer has. Vite fires
// `vite:preloadError`, and the recovery must land the page on the current build
// — but only ever *one* attempt, or an asset that is genuinely gone would
// reload forever. The stale shell is normally served by the old service worker
// from its precache, so the attempt is not a plain reload (which the same
// worker would answer identically): the newer worker is applied, or the
// registration is dropped so the reload reaches the network.
describe('startStaleShellRecovery', () => {
  type State = ServiceWorkerState

  /** A ServiceWorker: an EventTarget with a state that tests move along. */
  class FakeWorker extends EventTarget {
    constructor(public state: State) {
      super()
    }
    set(state: State) {
      this.state = state
      this.dispatchEvent(new Event('statechange'))
    }
  }

  /** A ServiceWorkerRegistration with the members the recovery touches. */
  class FakeRegistration extends EventTarget {
    waiting: FakeWorker | null = null
    installing: FakeWorker | null = null
    update = vi.fn<() => Promise<void>>(() => Promise.resolve())
    unregister = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
    /** The update check finds a new worker: it appears as `installing`. */
    findUpdate(): FakeWorker {
      const w = new FakeWorker('installing')
      this.installing = w
      this.dispatchEvent(new Event('updatefound'))
      return w
    }
    /** The installing worker finishes and waits. */
    finishInstall(w: FakeWorker) {
      this.installing = null
      this.waiting = w
      w.set('installed')
    }
  }

  const asRegistration = (r: FakeRegistration) => r as unknown as ServiceWorkerRegistration

  function stubReload() {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    return reload
  }

  /** jsdom has no navigator.serviceWorker; install one with the lookup the fallback uses. */
  function stubNavigatorSW(registration: FakeRegistration | undefined) {
    const getRegistration = vi.fn(() => Promise.resolve(registration))
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration },
    })
    return getRegistration
  }

  /** Lets the async recovery run its microtasks (and `ms` of fake time) without touching real timers. */
  const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

  const fail = () => window.dispatchEvent(new Event(PRELOAD_ERROR_EVENT))

  let stopRecovery: (() => void) | undefined
  let dropEscape: (() => void) | undefined

  function provide(registration: FakeRegistration) {
    const updateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve())
    dropEscape?.()
    dropEscape = provideStaleShellEscape({ registration: asRegistration(registration), updateServiceWorker })
    return updateServiceWorker
  }

  beforeEach(() => {
    sessionStorage.clear()
    stubNavigatorSW(undefined)
  })
  afterEach(async () => {
    // Let a recovery still waiting on its budget run out against the stubs of
    // this test, so no hand-over waiter survives into the next one.
    await vi.runOnlyPendingTimersAsync()
    stopRecovery?.()
    stopRecovery = undefined
    dropEscape?.()
    dropEscape = undefined
    vi.restoreAllMocks()
    sessionStorage.clear()
    // Property added by stubNavigatorSW; jsdom's navigator has none of its own.
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
  })

  describe('with a newer worker', () => {
    it('applies a waiting worker the way the Reload button does, and reloads', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.waiting = new FakeWorker('installed')
      const updateServiceWorker = provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(updateServiceWorker).toHaveBeenCalledWith(true)
      expect(reg.unregister).not.toHaveBeenCalled()
      // applyUpdate's backstop: the worker's own controllerchange reload may
      // never come (issue #120), so the page navigates itself.
      expect(reload).not.toHaveBeenCalled()
      await settle(RELOAD_FALLBACK_MS)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('waits for a worker that is still installing, then applies it', async () => {
      stubReload()
      const reg = new FakeRegistration()
      const w = reg.findUpdate()
      const updateServiceWorker = provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(2000)
      expect(updateServiceWorker).not.toHaveBeenCalled()
      expect(reg.unregister).not.toHaveBeenCalled()

      reg.finishInstall(w)
      await settle()
      expect(updateServiceWorker).toHaveBeenCalledWith(true)
      expect(reg.unregister).not.toHaveBeenCalled()
    })

    it('picks up a worker the update check finds after the failure', async () => {
      stubReload()
      const reg = new FakeRegistration()
      // The check is still running when the chunk fails: update() has not
      // settled and nothing is installing yet.
      let checkDone!: () => void
      reg.update.mockImplementation(() => new Promise<void>((r) => (checkDone = r)))
      const updateServiceWorker = provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(reg.update).toHaveBeenCalledTimes(1)
      const w = reg.findUpdate()
      checkDone()
      await settle()
      expect(reg.unregister).not.toHaveBeenCalled()

      reg.finishInstall(w)
      await settle()
      expect(updateServiceWorker).toHaveBeenCalledWith(true)
    })

    it('uses a hand-over that arrives after the failure, within the budget', async () => {
      // On a fresh load the catalog can render — and import a missing icon
      // chunk — before workbox-window has registered. Losing that race must not
      // cost the waiting worker.
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.waiting = new FakeWorker('installed')
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(1000)
      expect(reload).not.toHaveBeenCalled()

      const updateServiceWorker = provide(reg)
      await settle()
      expect(updateServiceWorker).toHaveBeenCalledWith(true)
      expect(reg.unregister).not.toHaveBeenCalled()
    })
  })

  describe('without one', () => {
    it('unregisters and reloads at once when the check finds the same worker', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      const updateServiceWorker = provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      // update() resolved with nothing installing: no point waiting.
      expect(reg.unregister).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(updateServiceWorker).not.toHaveBeenCalled()
    })

    it('unregisters and reloads when the update check fails (offline)', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.update.mockRejectedValue(new Error('offline'))
      provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(reg.unregister).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('gives up on an install that fails', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      const w = reg.findUpdate()
      provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(reload).not.toHaveBeenCalled()
      reg.installing = null
      w.set('redundant')
      await settle()
      expect(reg.unregister).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('gives up on an install that outlasts the budget', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.findUpdate()
      provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(STALE_WORKER_WAIT_MS - 1)
      expect(reload).not.toHaveBeenCalled()
      await settle(1)
      expect(reg.unregister).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('still reloads when unregistering rejects', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.unregister.mockRejectedValue(new Error('gone'))
      provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('drops an earlier visit\'s registration when no hand-over comes', async () => {
      // UpdateNotice never mounted (the shell broke before it), but the
      // navigation may still have been served by a worker registered last time.
      const reload = stubReload()
      const reg = new FakeRegistration()
      const getRegistration = stubNavigatorSW(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(STALE_WORKER_WAIT_MS)
      expect(getRegistration).toHaveBeenCalled()
      expect(reg.unregister).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('falls back to a plain reload with no registration and no hand-over', async () => {
      const reload = stubReload()
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(STALE_WORKER_WAIT_MS)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('reloads plainly, at once, where service workers are unsupported', async () => {
      const reload = stubReload()
      delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('stops waiting for a hand-over once registration is reported failed', async () => {
      // The #156 e2e shape: the chunk that fails *is* workbox-window, so the
      // registration never happens and nothing is ever handed over.
      const reload = stubReload()
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(500)
      expect(reload).not.toHaveBeenCalled()
      dropEscape = declineStaleShellEscape()
      await settle()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('does not wait at all when registration had already failed', async () => {
      const reload = stubReload()
      dropEscape = declineStaleShellEscape()
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle()
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })

  describe('the one-attempt guard', () => {
    it('does not start a second recovery for a second failure in the same session', async () => {
      const reload = stubReload()
      const reg = new FakeRegistration()
      provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      fail()
      fail()
      await settle()
      expect(reg.unregister).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('does nothing when the recovered page fails the same way', async () => {
      // The flag survives the reload, which is the whole point: the page that
      // comes back is the one that must not bounce again.
      sessionStorage.setItem(STALE_SHELL_RELOAD_KEY, '1')
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.waiting = new FakeWorker('installed')
      const updateServiceWorker = provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(STALE_WORKER_WAIT_MS + RELOAD_FALLBACK_MS)
      expect(updateServiceWorker).not.toHaveBeenCalled()
      expect(reg.unregister).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })

    it('records the attempt so the recovered page can recognise it', async () => {
      stubReload()
      stopRecovery = startStaleShellRecovery()

      fail()
      expect(sessionStorage.getItem(STALE_SHELL_RELOAD_KEY)).not.toBeNull()
    })

    it('stays put when sessionStorage is unavailable, rather than risking a loop', async () => {
      // Private-mode / blocked storage: without somewhere to remember the attempt
      // the guard cannot hold, so no recovery happens at all — the icon boundary
      // still keeps the page usable.
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })
      const reload = stubReload()
      const reg = new FakeRegistration()
      reg.waiting = new FakeWorker('installed')
      const updateServiceWorker = provide(reg)
      stopRecovery = startStaleShellRecovery()

      fail()
      await settle(STALE_WORKER_WAIT_MS + RELOAD_FALLBACK_MS)
      expect(updateServiceWorker).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })
  })

  it('stops listening once torn down', async () => {
    const reload = stubReload()
    startStaleShellRecovery()()

    fail()
    await settle(STALE_WORKER_WAIT_MS)
    expect(reload).not.toHaveBeenCalled()
  })

  it('a hand-over teardown only drops its own hand-over', async () => {
    const reload = stubReload()
    const stale = new FakeRegistration()
    const dropStale = provideStaleShellEscape({
      registration: asRegistration(stale),
      updateServiceWorker: vi.fn(() => Promise.resolve()),
    })
    const current = new FakeRegistration()
    current.waiting = new FakeWorker('installed')
    const updateServiceWorker = provide(current)
    // A late unmount of the earlier provider (React's double invocation) must
    // not remove the registration that is actually live.
    dropStale()
    stopRecovery = startStaleShellRecovery()

    fail()
    await settle()
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(stale.unregister).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('listens for the event Vite actually emits', () => {
    expect(PRELOAD_ERROR_EVENT).toBe('vite:preloadError')
  })

  it('waits ten seconds at most for a worker that is installing', () => {
    expect(STALE_WORKER_WAIT_MS).toBe(10_000)
  })
})
