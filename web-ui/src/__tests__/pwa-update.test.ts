import { RELOAD_FALLBACK_MS, UPDATE_POLL_INTERVAL_MS, applyUpdate, startUpdateChecks } from '@/lib/pwa-update'

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
