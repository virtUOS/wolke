// "Neue Version verfügbar." — the in-app update prompt (issue #42).
//
// The service worker runs in prompt mode: a new deploy's worker installs and
// then *waits*. This notice is the only way a long-lived tab or an installed
// PWA learns about it. It never reloads on its own — admin forms exist, and a
// reload the user didn't ask for eats input — so it stays passive until the
// Reload button is clicked. That click must always visibly do something: the
// worker's own reload only happens on a `controllerchange`, which an
// uncontrolled desktop tab never sees, so applying an update goes through
// lib/pwa-update's applyUpdate, which navigates itself if the worker doesn't
// (issue #120).

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { t, type Lang } from '@/lib/i18n'
import { SW_NEED_REFRESH_EVENT, applyUpdate, startUpdateChecks } from '@/lib/pwa-update'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

export function UpdateNotice({ locale }: { locale: Lang }) {
  const s = t(locale)

  // How many waiting workers this page load has been told about. Counted from
  // the callback rather than read off the hook's `needRefresh` flag, because
  // that flag is already true when a *second* deploy arrives in a long-lived
  // tab — so a dismissal would silence every later update (issue #95 review).
  const [swUpdates, setSwUpdates] = useState(0)
  // The e2e seam (lib/pwa-update): the same notice, without a waiting worker.
  const [seamUpdates, setSeamUpdates] = useState(0)
  const [dismissedAt, setDismissedAt] = useState(0)
  const [applying, setApplying] = useState(false)

  const stopChecks = useRef<(() => void) | null>(null)
  const cancelReload = useRef<(() => void) | null>(null)

  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh: () => setSwUpdates((n) => n + 1),
    onRegisteredSW: (_swUrl, registration) => {
      if (!registration) return
      // Keep the teardown: registration can be reported more than once (React's
      // dev-mode double invocation, a re-registration), and each call would
      // otherwise leave an orphaned interval and visibility listener behind.
      stopChecks.current?.()
      stopChecks.current = startUpdateChecks(registration)
    },
  })

  useEffect(() => {
    const onSeam = () => setSeamUpdates((n) => n + 1)
    window.addEventListener(SW_NEED_REFRESH_EVENT, onSeam)
    return () => {
      window.removeEventListener(SW_NEED_REFRESH_EVENT, onSeam)
      stopChecks.current?.()
      cancelReload.current?.()
    }
  }, [])

  // How many updates this page load has been told about. A dismissal just
  // records the count it was made at — nothing is persisted, because the next
  // load already runs the new version, and a tab that lives on and hears about
  // a *later* update raises the count and so shows the notice again. Derived
  // rather than synced through an effect, so there is no render-then-correct
  // pass and no state to keep consistent.
  const updates = swUpdates + seamUpdates
  if (updates === 0 || updates === dismissedAt) return null

  const reload = () => {
    // Ignore a second click: the first one is already taking the page away, and
    // a repeat skip-waiting message would race its own reload.
    if (applying) return
    setApplying(true)
    // With a worker waiting, apply it and navigate (lib/pwa-update). Reached
    // through the seam there is none, so a plain reload is the honest
    // equivalent: fetch whatever the server serves now.
    if (swUpdates > 0) cancelReload.current = applyUpdate(updateServiceWorker)
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
        <Button size="sm" className="min-h-11 md:min-h-9" onClick={reload} disabled={applying}>
          {s.update.reload}
        </Button>
      </div>
      <IconButton
        variant="plain"
        aria-label={s.update.dismiss}
        className="h-11 w-11 shrink-0 md:h-9 md:w-9"
        onClick={() => setDismissedAt(updates)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </IconButton>
    </div>
  )
}
