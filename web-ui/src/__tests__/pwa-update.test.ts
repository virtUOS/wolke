import { UPDATE_POLL_INTERVAL_MS, startUpdateChecks } from '@/lib/pwa-update'

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
