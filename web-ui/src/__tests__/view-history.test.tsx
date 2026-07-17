import { act, renderHook } from '@testing-library/react'
import { useViewHistory } from '@/lib/view-history'
import { DEFAULT_VIEW } from '@/lib/view-url'

// Each test starts from a known URL; jsdom's history implementation is real
// enough for replaceState/pushState + manually dispatched PopStateEvents
// (history.back() timing is not reliable in jsdom, so popstate is simulated).
function setURL(path: string) {
  window.history.replaceState(null, '', path)
}

afterEach(() => {
  setURL('/')
  vi.restoreAllMocks()
})

describe('useViewHistory', () => {
  it('parses the initial view from the URL (deep link)', () => {
    setURL('/?cat=lehre')
    const { result } = renderHook(() => useViewHistory())
    expect(result.current.view).toEqual({ tab: 'dienste', filter: { kind: 'category', slug: 'lehre' }, admin: false })
  })

  it('navigate pushes one history entry and updates the URL', () => {
    setURL('/')
    const push = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useViewHistory())
    act(() => result.current.navigate({ tab: 'dienste', filter: { kind: 'maintenance' }, admin: false }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?filter=wartung')
    expect(result.current.view.filter).toEqual({ kind: 'maintenance' })
  })

  it('navigate to the current view is a no-op (no duplicate entries)', () => {
    setURL('/')
    const push = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useViewHistory())
    act(() => result.current.navigate({ ...DEFAULT_VIEW }))
    expect(push).not.toHaveBeenCalled()
  })

  it('popstate restores the view from the URL and calls onPop without pushing', () => {
    setURL('/?tab=dienste')
    const onPop = vi.fn()
    const push = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useViewHistory({ onPop }))
    expect(result.current.view.tab).toBe('dienste')

    // Simulate the browser going Back to "/".
    act(() => {
      setURL('/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current.view).toEqual(DEFAULT_VIEW)
    expect(onPop).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('replace rewrites the URL without creating an entry', () => {
    setURL('/?cat=lehre')
    const push = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useViewHistory())
    act(() => result.current.replace({ ...result.current.view, filter: { kind: 'all' } }))
    expect(push).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?tab=dienste')
    expect(result.current.view.filter).toEqual({ kind: 'all' })
  })
})
