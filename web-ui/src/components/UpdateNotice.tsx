// "Neue Version verfügbar." — the in-app update prompt (issue #42).
//
// The service worker runs in prompt mode: a new deploy's worker installs and
// then *waits*. This notice is the only way a long-lived tab or an installed
// PWA learns about it. It never reloads on its own — admin forms exist, and a
// reload the user didn't ask for eats input — so it stays passive until the
// Reload button is clicked.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { t, type Lang } from '@/lib/i18n'
import { SW_NEED_REFRESH_EVENT, startUpdateChecks } from '@/lib/pwa-update'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

export function UpdateNotice({ locale }: { locale: Lang }) {
  const s = t(locale)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_swUrl, registration) => {
      if (registration) startUpdateChecks(registration)
    },
  })

  // The e2e seam (lib/pwa-update): the same notice, without a waiting worker.
  const [seamFired, setSeamFired] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const onSeam = () => {
      setSeamFired(true)
      setDismissed(false)
    }
    window.addEventListener(SW_NEED_REFRESH_EVENT, onSeam)
    return () => window.removeEventListener(SW_NEED_REFRESH_EVENT, onSeam)
  }, [])

  // A dismissal lasts for this page load only — nothing is persisted, because
  // the next load already runs the new version. A tab that lives on and detects
  // a *later* update should see the notice again, so the flag clears whenever
  // needRefresh rises.
  useEffect(() => {
    if (needRefresh) setDismissed(false)
  }, [needRefresh])

  if (dismissed || !(needRefresh || seamFired)) return null

  const reload = () => {
    // With a worker waiting, updateServiceWorker(true) activates it and reloads.
    // Reached through the seam there is none, so a plain reload is the honest
    // equivalent: fetch whatever the server serves now.
    if (needRefresh) void updateServiceWorker(true)
    else window.location.reload()
  }

  return (
    <div
      // Polite: an available update is news, not an emergency.
      role="status"
      // The entry animation is a plain CSS class so the global
      // prefers-reduced-motion reset in index.css neutralises it.
      className="update-notice"
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        // Leaves the bottom-right corner free for the assistant launcher
        // (AssistantWidget) at every width in the viewport matrix — 324px
        // included — instead of a breakpoint-dependent guess.
        maxWidth: 'min(420px, calc(100vw - 104px))',
        zIndex: 30,
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 6px 24px color-mix(in srgb, var(--text) 18%, transparent)',
        padding: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm">{s.update.available}</p>
        <Button size="sm" className="min-h-11 md:min-h-9" onClick={reload}>
          {s.update.reload}
        </Button>
      </div>
      <IconButton
        variant="plain"
        aria-label={s.update.dismiss}
        className="h-11 w-11 shrink-0 md:h-9 md:w-9"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}
