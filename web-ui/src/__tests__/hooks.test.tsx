import { renderHook } from '@testing-library/react'
import { useApplyTheme } from '@/lib/hooks'

// Issue #28: 'system' is a real theme option now (not just an implicit
// pre-selection), so it must keep following prefers-color-scheme changes
// live, the way it always has.
describe('useApplyTheme', () => {
  function mockMatchMedia(initialMatches: boolean) {
    let matches = initialMatches
    let listener: (() => void) | undefined
    const mql = {
      get matches() {
        return matches
      },
      addEventListener: (_: string, l: () => void) => {
        listener = l
      },
      removeEventListener: () => {
        listener = undefined
      },
    }
    window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
    return {
      setMatches: (v: boolean) => {
        matches = v
        listener?.()
      },
    }
  }

  afterEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('theme "dark" applies .dark regardless of the OS preference', () => {
    mockMatchMedia(false)
    renderHook(() => useApplyTheme('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('theme "light" never applies .dark, even if the OS prefers dark', () => {
    mockMatchMedia(true)
    renderHook(() => useApplyTheme('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('theme "system" follows the OS preference, including live changes', () => {
    const { setMatches } = mockMatchMedia(false)
    renderHook(() => useApplyTheme('system'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    setMatches(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    setMatches(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
