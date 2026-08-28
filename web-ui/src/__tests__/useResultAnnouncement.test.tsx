import { act, renderHook } from '@testing-library/react'
import { ANNOUNCEMENT_MS, useResultAnnouncement } from '@/lib/hooks'

// The live region must be empty at rest (issue #35). Every path out of the hook
// has to end quiet: the bug this file guards against was a hide timer owned by
// the count effect, which cleaned the timer up whenever the count changed again
// and then returned early without setting a replacement — leaving the region
// populated for good.

const count = (n: number) => `${n} ${n === 1 ? 'Dienst' : 'Dienste'}`

function setup(initial: { count: number | null; message: string }) {
  return renderHook(({ count: c, message }: { count: number | null; message: string }) => useResultAnnouncement(c, message), {
    initialProps: initial,
  })
}

describe('useResultAnnouncement', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('says nothing on the first settled count', () => {
    const { result } = setup({ count: 7, message: count(7) })
    expect(result.current).toBe('')
  })

  it('says nothing while the count is still arriving', () => {
    const { result, rerender } = setup({ count: null, message: count(0) })
    rerender({ count: null, message: count(0) })
    expect(result.current).toBe('')
  })

  it('announces a change, then goes quiet again', () => {
    const { result, rerender } = setup({ count: 7, message: count(7) })
    rerender({ count: 1, message: count(1) })
    expect(result.current).toBe('1 Dienst')

    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS))
    expect(result.current).toBe('')
  })

  it('stays quiet when the count is unchanged', () => {
    const { result, rerender } = setup({ count: 7, message: count(7) })
    rerender({ count: 7, message: count(7) })
    expect(result.current).toBe('')
  })

  it('does not announce on a message change alone (locale switch)', () => {
    const { result, rerender } = setup({ count: 7, message: '7 Dienste' })
    rerender({ count: 7, message: '7 services' })
    expect(result.current).toBe('')
  })

  // The regression: typing again inside the announcement window puts a query in
  // flight, so the settled count goes null mid-window.
  it('still goes quiet when the count goes null inside the window', () => {
    const { result, rerender } = setup({ count: 7, message: count(7) })
    rerender({ count: 1, message: count(1) })
    expect(result.current).toBe('1 Dienst')

    act(() => void vi.advanceTimersByTime(1000))
    rerender({ count: null, message: count(1) })
    expect(result.current).toBe('1 Dienst')

    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS))
    expect(result.current).toBe('')
  })

  it('still goes quiet when the same count settles again inside the window', () => {
    const { result, rerender } = setup({ count: 7, message: count(7) })
    rerender({ count: 1, message: count(1) })
    act(() => void vi.advanceTimersByTime(1000))
    rerender({ count: 1, message: count(1) })

    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS))
    expect(result.current).toBe('')
  })

  it('still goes quiet when only the message changes inside the window', () => {
    const { result, rerender } = setup({ count: 7, message: '7 Dienste' })
    rerender({ count: 1, message: '1 Dienst' })
    act(() => void vi.advanceTimersByTime(1000))
    rerender({ count: 1, message: '1 service' })

    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS))
    expect(result.current).toBe('')
  })

  it('announces the next real change after having gone quiet', () => {
    const { result, rerender } = setup({ count: 7, message: count(7) })
    rerender({ count: 1, message: count(1) })
    act(() => void vi.advanceTimersByTime(ANNOUNCEMENT_MS))
    expect(result.current).toBe('')

    rerender({ count: 4, message: count(4) })
    expect(result.current).toBe('4 Dienste')
  })
})
