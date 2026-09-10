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

// The other side of the update story (issue #150). Everything above handles "a
// new version is available": the worker has already fetched it and waits for the
// user's click. What follows handles the opposite case — "the version you have is
// already gone". A tab (or a precached shell) can hold an index.html naming
// hashed chunks the current deployment no longer has, so a lazy import 404s.
// Nothing is waiting to be applied and there is nothing to ask the user about:
// the only cure is to fetch the shell again.
//
// Fetching it again is not a plain reload, though (issue #158). The stale shell
// is normally *served by the old service worker from its precache*; the one
// chunk that is not precached (icon-set, vite.config `globIgnores`) is the one
// that reaches the server and 404s. A plain reload asks the same worker for the
// same shell and gets the same missing chunk — and with the guard already spent,
// the page stayed on a build that no longer exists (blank, in production, before
// #151's boundary). The recovery below therefore escapes the old worker:
// sw.js is served no-cache, so the new deploy's worker is already installing or
// waiting; it is activated (the same skip-waiting path as the Reload button, so
// the reload lands on the new precache), and when no worker turns up the
// registration is unregistered so the reload goes to the network instead —
// unless the network is what is gone, in which case the recovery does nothing
// at all rather than trading a rendered page for an error page (issue #162).

/**
 * Vite's event for a dynamic import whose chunk could not be fetched. Emitted by
 * the preload helper in the build output, so it fires in production, which is
 * the only place the stale-shell shape occurs.
 */
export const PRELOAD_ERROR_EVENT = 'vite:preloadError'

/**
 * Where the last recovery attempt is recorded, as an epoch-millisecond
 * timestamp. sessionStorage, not the API: this is not app data (CLAUDE.md
 * forbids storing that in the browser) but a per-tab loop guard that must be
 * readable by the very page load it guards — before any request could answer,
 * and while the app may be too broken to make one.
 */
export const STALE_SHELL_RELOAD_KEY = 'wolke:stale-shell-reload'

/**
 * How long a recovery blocks the next one in the same tab.
 *
 * The guard has to separate two things that both arrive as a failed chunk: a
 * deploy the tab missed (recover), and an asset that is simply gone for good
 * (stop, or the page reloads forever — that loop is what made #158 blank). It
 * separates them by timescale, which needs no counter and no build identity:
 * deploys are minutes to days apart, while a genuine loop recurs in seconds,
 * as fast as the page can come back. Five minutes sits between the two.
 *
 * The property this buys, and the point of the guard: at most one recovery per
 * tab per five minutes, so a pathological page reloads about twelve times an
 * hour instead of without bound — while a long-lived tab or installed PWA
 * window still self-heals across every later deploy (issue #164). The previous
 * one-shot flag bounded the loop just as well but spent the tab's only
 * recovery on the first deploy it saw, leaving weeks-old PWA windows on
 * fallback glyphs until the user noticed the update notice.
 *
 * Deliberately not cleared on a successful mount: the app can mount and *then*
 * fail the same chunk (the icon is lazy and rendered late), so clearing there
 * would re-arm the guard on every bounce — exactly the unbounded loop it
 * exists to prevent. Telling that apart from a real recovery needs build
 * identity in the guard, which this does not warrant.
 */
export const STALE_SHELL_RETRY_AFTER_MS = 5 * 60 * 1000

/**
 * How long the recovery waits for the new deploy's worker to finish installing
 * before it gives up on it and unregisters instead. The install is a precache
 * download of the whole shell (~700 KiB); ten seconds covers a slow mobile link,
 * and the fallback that follows still recovers the page — it just re-downloads.
 * Only reached while a worker is *actually installing*: when the update check
 * finds nothing, the fallback runs at once.
 */
export const STALE_WORKER_WAIT_MS = 10_000

/**
 * What the registered service worker hands the recovery: the registration, to
 * see whether a newer worker is installing or waiting, and vite-plugin-pwa's
 * updateServiceWorker, to activate it. Provided by UpdateNotice (the owner of
 * useRegisterSW) as module state rather than React state, because the recovery
 * starts in main.tsx before React mounts and runs from a plain event listener.
 */
export interface StaleShellEscape {
  registration: ServiceWorkerRegistration
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
}

let escape: StaleShellEscape | null = null
/** Registration failed, so no hand-over is coming — the recovery must not wait for one. */
let escapeDeclined = false
let escapeWaiters: Array<(e: StaleShellEscape | null) => void> = []

function settleEscapeWaiters(value: StaleShellEscape | null) {
  const waiters = escapeWaiters
  escapeWaiters = []
  for (const resolve of waiters) resolve(value)
}

/**
 * Registers the escape hatch for the stale-shell recovery. Returns a teardown
 * that only clears its own hand-over, so a stale unmount cannot drop a newer one.
 */
export function provideStaleShellEscape(next: StaleShellEscape): () => void {
  escape = next
  escapeDeclined = false
  settleEscapeWaiters(next)
  return () => {
    if (escape === next) escape = null
  }
}

/**
 * Tells the recovery that registration failed (vite-plugin-pwa's
 * onRegisterError), so it stops waiting for a hand-over and falls back at once.
 * The stale shell's own failing chunk can be workbox-window itself. Returns a
 * teardown that clears the notice again.
 */
export function declineStaleShellEscape(): () => void {
  escapeDeclined = true
  settleEscapeWaiters(null)
  return () => {
    escapeDeclined = false
  }
}

/**
 * The hand-over, waiting up to `timeoutMs` for it. The failing chunk and the
 * registration race each other on a fresh page load — the catalog can render
 * (and import a missing icon chunk) before workbox-window has registered — and
 * losing that race must not cost the waiting worker.
 */
function awaitEscape(timeoutMs: number): Promise<StaleShellEscape | null> {
  if (escape) return Promise.resolve(escape)
  if (escapeDeclined) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      escapeWaiters = escapeWaiters.filter((w) => w !== onArrival)
      resolve(null)
    }, timeoutMs)
    const onArrival = (e: StaleShellEscape | null) => {
      clearTimeout(timer)
      resolve(e)
    }
    escapeWaiters.push(onArrival)
  })
}

/**
 * Claims a recovery for this tab, and records when. Returns false while the
 * last one is less than STALE_SHELL_RETRY_AFTER_MS old — and also when
 * sessionStorage is unavailable (private mode, blocked site data), because a
 * guard that cannot remember is no guard at all and a reload loop is worse than
 * a missing icon. Either way the lazy component's error boundary (lib/icons)
 * keeps the page usable.
 *
 * A stored value that is not a number cannot be dated, so it counts as "just
 * now" and refuses: the safe direction, and the only writer is the line below.
 * A clock that has jumped backwards refuses for the same reason.
 *
 * The attempt is the escape, not a plain reload first. A plain reload only
 * helps a tab that no worker serves, and there the escape *is* a plain reload
 * (no registration, nothing to unregister). Wherever a worker is registered, a
 * plain reload lands on its precache again — whether the tab was controlled or
 * not, the navigation is — and would spend the claim on a retry that cannot
 * succeed, which is exactly the #158 blank page.
 */
function claimStaleShellReload(): boolean {
  try {
    const last = sessionStorage.getItem(STALE_SHELL_RELOAD_KEY)
    if (last !== null) {
      const at = Number(last)
      if (!Number.isFinite(at)) return false
      const since = Date.now() - at
      if (since < STALE_SHELL_RETRY_AFTER_MS) return false
    }
    sessionStorage.setItem(STALE_SHELL_RELOAD_KEY, String(Date.now()))
    return true
  } catch {
    return false
  }
}

/**
 * Hands the claim back, so the next failure can still recover instead of
 * waiting out the window. Only ever called from a path that did nothing at all
 * — no unregister, no reload (issue #162) — so it cannot open the door to the
 * loop the guard exists to prevent. (A tab whose storage is unavailable never
 * gets here: the claim fails first.)
 */
function releaseStaleShellReload(): void {
  try {
    sessionStorage.removeItem(STALE_SHELL_RELOAD_KEY)
  } catch {
    // Nothing was stored, so there is nothing to hand back.
  }
}

/**
 * Resolves with the newer worker once it has installed (and is waiting), or with
 * null when none is coming: the update check found the same sw.js, the install
 * failed, or it took longer than `timeoutMs`.
 */
function awaitWaitingWorker(reg: ServiceWorkerRegistration, timeoutMs: number): Promise<ServiceWorker | null> {
  if (reg.waiting) return Promise.resolve(reg.waiting)
  return new Promise((resolve) => {
    let settled = false
    const finish = (worker: ServiceWorker | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reg.removeEventListener('updatefound', onUpdateFound)
      resolve(worker)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return
      const onState = () => {
        // 'installing' is the only state still worth waiting on: 'installed'
        // means it is waiting; 'activating'/'activated' means it took over on
        // its own (nothing was active) and a reload lands on it; 'redundant'
        // means the install failed.
        if (worker.state === 'installing') return
        worker.removeEventListener('statechange', onState)
        finish(worker.state === 'redundant' ? null : worker)
      }
      worker.addEventListener('statechange', onState)
      onState()
    }
    const onUpdateFound = () => watch(reg.installing)
    reg.addEventListener('updatefound', onUpdateFound)
    watch(reg.installing)
    // Make sure a check is under way (registration already ran one on this
    // page load, but it may have been rejected offline). update() settles when
    // the check has either started an install — watched above — or found the
    // same script, in which case nothing will ever arrive.
    reg.update().then(
      () => {
        if (!reg.installing && !reg.waiting) finish(null)
      },
      () => finish(null),
    )
  })
}

/**
 * What the recovery probes to find out whether there is a network at all
 * (issue #162). sw.js is the right target: same-origin, tiny, served `no-cache`
 * by the Go handler, and deliberately not precached — the service worker has no
 * route for it, so the answer comes from the network or not at all.
 */
export const NETWORK_PROBE_URL = '/sw.js'

/**
 * How long that probe may take before the network counts as gone. Short,
 * because the page it protects is already rendered (the icon boundary is
 * showing its fallback glyph): the cost of waiting is a delayed recovery, never
 * a broken page.
 */
export const NETWORK_PROBE_TIMEOUT_MS = 3000

/**
 * Whether there is a route to the network right now.
 *
 * The recovery cannot tell "the chunk is gone" from "the network is gone" —
 * both reach it as one failed dynamic import (issue #162) — so it asks.
 * `navigator.onLine` is believed only in the negative (false means there is no
 * link at all; true only means some interface is up), and the real evidence is
 * an answer from the server. *Any* answer counts, a 404 or a 502 included:
 * what is under test is the route, not the response.
 */
async function networkReachable(): Promise<boolean> {
  if (navigator.onLine === false) return false
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), NETWORK_PROBE_TIMEOUT_MS)
  try {
    await fetch(NETWORK_PROBE_URL, { cache: 'no-store', signal: abort.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The destructive half of the recovery, and the only place it happens: drop the
 * registration (when there is one) so the reload cannot be answered by the old
 * worker's precache, then reload — landing the page on whatever the network
 * serves now.
 *
 * Both steps are gated on the network being reachable, because offline they are
 * strictly worse than doing nothing (issue #162). By the time the recovery
 * runs, the page is rendered and usable — the lazy icon's error boundary
 * (lib/icons) shows a fallback glyph for the chunk that did not load. A reload
 * with no route to the network replaces that with the browser's own error page,
 * and the unregister also takes away the worker that was serving the shell:
 * the user ends up with no page *and* no worker, from a state that worked.
 *
 * So with no network this returns having done nothing whatsoever: no
 * unregister, no reload, and the guard handed back — nothing was spent, and the
 * next load that has a network recovers normally. Doing nothing reads like an
 * omission, which is why it is written down here: it is the correct outcome.
 */
async function reloadFromNetwork(reg: ServiceWorkerRegistration | null): Promise<void> {
  if (!(await networkReachable())) {
    releaseStaleShellReload()
    return
  }
  if (reg) await reg.unregister()
  window.location.reload()
}

/**
 * Leaves the old service worker behind and lands the page on the current
 * deployment, one way or another:
 *
 * 1. A newer worker is waiting (or finishes installing within
 *    STALE_WORKER_WAIT_MS): apply it exactly as the Reload button does —
 *    skip-waiting through updateServiceWorker(true), which reloads on the
 *    control change, with applyUpdate's own reload as the backstop.
 * 2. Otherwise unregister the registration, so the reload is not matched to the
 *    old worker and fetches the shell from the network; the page that comes up
 *    registers a fresh worker for the current build.
 * 3. No registration at all (unsupported, or never registered): a plain reload,
 *    which then already goes to the network.
 *
 * The hand-over from UpdateNotice is awaited too, within the same budget, since
 * a fresh page can lose a chunk before workbox-window has registered — unless
 * registration is reported failed, which ends the wait at once.
 *
 * Steps 2 and 3 go through reloadFromNetwork, which does nothing at all when
 * the network is what is gone (issue #162). Step 1 is not gated: a worker that
 * has already installed serves the new build from its own precache, so applying
 * it is a recovery that works offline too.
 */
async function escapeStaleShell(): Promise<void> {
  // Without service workers nothing but the network served this shell, and
  // nothing will ever register: a plain reload is the whole recovery.
  if (!('serviceWorker' in navigator)) {
    await reloadFromNetwork(null)
    return
  }
  // One budget for both waits: the hand-over from UpdateNotice, then the
  // newer worker's install.
  const deadline = Date.now() + STALE_WORKER_WAIT_MS
  const current = await awaitEscape(STALE_WORKER_WAIT_MS)
  if (current) {
    const waiting = await awaitWaitingWorker(current.registration, Math.max(0, deadline - Date.now()))
    if (waiting) {
      applyUpdate(current.updateServiceWorker)
      return
    }
    await reloadFromNetwork(current.registration)
    return
  }
  // No hand-over came (registration failed, or the shell never got as far as
  // mounting UpdateNotice), but a worker from an earlier visit may still own
  // the navigation: look it up directly.
  const reg = await navigator.serviceWorker.getRegistration()
  await reloadFromNetwork(reg ?? null)
}

/**
 * Starts self-healing for a stale shell: on a failed chunk preload, escape the
 * service worker that served it and land on whatever the server serves now
 * (see escapeStaleShell), at most once per STALE_SHELL_RETRY_AFTER_MS. Returns
 * a teardown for tests.
 *
 * The event is deliberately *not* cancelled — the rejection still reaches the
 * lazy component's error boundary, so the render degrades to a fallback whether
 * or not this recovery happens or helps.
 */
export function startStaleShellRecovery(): () => void {
  const onPreloadError = () => {
    if (!claimStaleShellReload()) return
    escapeStaleShell().catch(() => {
      // Whatever went wrong on the way (a rejected unregister, a registration
      // that vanished), the last resort is still a reload — but the same
      // offline gate applies to it: with no network, a reload would take away
      // the page the boundary is still rendering (issue #162).
      void reloadFromNetwork(null)
    })
  }
  window.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError)
  return () => window.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError)
}
