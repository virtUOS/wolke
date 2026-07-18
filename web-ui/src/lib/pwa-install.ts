// PWA install-hint plumbing: capture the (Chromium-only) beforeinstallprompt
// event at module load — it can fire before React mounts — and expose the
// installability state to React via a subscribe/getSnapshot pair
// (useSyncExternalStore). The one-time dismissal lives in localStorage: THE
// sanctioned exception to the "no browser storage of app data" rule, because
// install state is inherently device-scoped — a server pref would hide the
// hint on the phone because it was dismissed on the desktop.

// Chromium's BeforeInstallPromptEvent (not in lib.dom.d.ts).
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'wolke:install-hint-dismissed'

let deferredPrompt: InstallPromptEvent | null = null
let dismissed = readDismissed()
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

// localStorage can throw (Safari private mode, storage disabled): degrade to
// an in-memory flag — the hint then reappears next visit, which is harmless.
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallHint(): void {
  dismissed = true
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // in-memory only; see above
  }
  notify()
}

// Registered from main.tsx at startup so no prompt event is missed.
export function initInstallCapture(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // suppress Chromium's mini-infobar; we show our own hint
    deferredPrompt = e as InstallPromptEvent
    notify()
  })
  // Installed (from our button or the browser UI): the hint is moot forever.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    dismissInstallHint()
  })
}

// promptInstall shows the browser's install dialog from the captured event.
// A prompt event is single-use; accepted or not, it is consumed.
export async function promptInstall(): Promise<void> {
  const e = deferredPrompt
  if (!e) return
  deferredPrompt = null
  notify()
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') dismissInstallHint()
}

// --- state for useSyncExternalStore ---

export function subscribeInstallHint(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export type InstallHintState = 'hidden' | 'installable' | 'ios'

// isStandalone: already running as an installed app (any platform); iOS Safari
// exposes the legacy navigator.standalone instead of the media query.
function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true
}

// Best-effort iOS detection (no beforeinstallprompt there; the hint becomes
// share-sheet instructions). iPadOS masquerades as macOS — accepted miss.
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

// The pure decision — exported for tests.
export function resolveInstallHint(opts: {
  installable: boolean
  ios: boolean
  standalone: boolean
  dismissed: boolean
}): InstallHintState {
  if (opts.dismissed || opts.standalone) return 'hidden'
  if (opts.installable) return 'installable'
  if (opts.ios) return 'ios'
  return 'hidden'
}

export function getInstallHintState(): InstallHintState {
  return resolveInstallHint({
    installable: deferredPrompt !== null,
    ios: isIOS(),
    standalone: isStandalone(),
    dismissed,
  })
}
