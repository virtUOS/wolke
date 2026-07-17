// useViewHistory owns the dashboard's View and keeps it in sync with the
// browser history, so Back/Forward walk through views (issue #29) and view
// URLs are deep-linkable. Mechanics: user actions call navigate() — the only
// place that pushes an entry (a compound change is one entry); invariant
// corrections call replace() (no entry); popstate only sets state, never
// pushes, so Back/Forward can't loop.

import { useEffect, useRef, useState } from 'react'
import { parseViewURL, viewEq, viewToURL, type View } from './view-url'

export function useViewHistory({ onPop }: { onPop?: () => void } = {}) {
  // Initial parse in the initializer: deep links work without any effect.
  const [view, setView] = useState<View>(() => parseViewURL(window.location.search))

  // The pop handler lives in a ref so the listener is subscribed exactly once
  // (kept current from an effect — refs must not be written during render).
  const onPopRef = useRef(onPop)
  useEffect(() => {
    onPopRef.current = onPop
  })

  useEffect(() => {
    const handler = () => {
      setView(parseViewURL(window.location.search))
      onPopRef.current?.()
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigate = (next: View) => {
    if (viewEq(view, next)) return // same target (e.g. rapid clicks): no duplicate entries
    window.history.pushState(null, '', viewToURL(next))
    setView(next)
  }

  const replace = (next: View) => {
    window.history.replaceState(null, '', viewToURL(next))
    setView(next)
  }

  return { view, navigate, replace }
}
