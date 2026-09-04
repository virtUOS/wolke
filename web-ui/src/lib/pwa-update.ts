// PWA update plumbing (issue #42). The service worker registers in prompt mode
// (vite.config.ts `registerType: 'prompt'`), so a new deploy never takes over
// silently: it waits, the app shows a notice, and only the user's click applies
// it. The plumbing lives here — the periodic update check, applying a waiting
// worker, and the e2e seam — so UpdateNotice stays a presentational component.

/**
 * How often a running tab asks the server whether a newer service worker exists.
 * One hour: invisible to the user, and it bounds how long an open tab or an
 * installed PWA can keep running a superseded bundle. Deliberately a constant,
 * not config — an operator has no reason to tune it (docs/02 §11.1).
 */
export const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000

/**
 * The CustomEvent that makes the notice testable end-to-end. Playwright cannot
 * build a second service-worker version against one embedded binary, so
 * `window.dispatchEvent(new CustomEvent('wolke:sw-need-refresh'))` shows the
 * real notice in the real layout (e2e/update-notice.spec.ts). Production code,
 * not a dev-only fork: the only difference is that no worker is waiting, so the
 * reload falls back to a plain navigation.
 */
export const SW_NEED_REFRESH_EVENT = 'wolke:sw-need-refresh'

/**
 * Starts the update checks for a registered service worker: every
 * UPDATE_POLL_INTERVAL_MS, and whenever the document becomes visible again —
 * the installed-PWA case is "phone unlocks, app resumes", which is exactly when
 * a check is worth making. Returns a teardown for tests/unmount.
 *
 * A failed check (offline, server restarting) is ignored: the next interval or
 * the next resume tries again.
 */
export function startUpdateChecks(registration: ServiceWorkerRegistration): () => void {
  const check = () => {
    void registration.update().catch(() => {
      // Transient; the next poll or resume retries.
    })
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }

  const timer = setInterval(check, UPDATE_POLL_INTERVAL_MS)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/**
 * How long a Reload click waits for the service worker's own reload before
 * navigating itself.
 *
 * vite-plugin-pwa's prompt mode only reloads from a `controllerchange`
 * (workbox's `controlling` event, and only when a worker controlled the page at
 * registration time). A desktop tab is regularly *uncontrolled* — the very
 * first load after the worker registers, and any hard reload — and the generated
 * worker does not call `clients.claim()`, so that event never arrives and the
 * click did nothing at all (issue #120). 1.5s is longer than the skip-waiting
 * handoff takes in practice, so the worker's own reload normally wins the race
 * and this timer never fires; when it does, the page still navigates.
 */
export const RELOAD_FALLBACK_MS = 1500

/**
 * Applies the waiting service worker and makes sure the page really navigates:
 * tells the worker to skip waiting, then reloads on our own after
 * RELOAD_FALLBACK_MS if the worker's `controllerchange` reload hasn't already
 * taken the page away.
 *
 * A plain reload after skip-waiting is enough to land the new bundle: the new
 * worker is active by then and serves the navigation from its own precache.
 *
 * Returns a canceller for unmount, so a notice that goes away never reloads a
 * page nobody asked to reload.
 */
export function applyUpdate(updateServiceWorker: (reloadPage?: boolean) => Promise<void>): () => void {
  // Armed before the worker is messaged, so nothing that call does — or fails
  // to do — can leave the click without an effect.
  const timer = setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS)
  void updateServiceWorker(true).catch(() => {
    // The reload above is the recovery: whatever the server serves now wins.
  })
  return () => clearTimeout(timer)
}
