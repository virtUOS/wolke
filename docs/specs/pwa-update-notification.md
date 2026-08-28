# Spec — PWA update notification (issue #42, second half)

Status: **ready to implement** · Owner: supervisor session · Written 2026-08-28
Issue: **#42** · Pre-launch (M4-adjacent) · Run with: **opus, new session off `main`.**

## 1. What exists, what's missing

#42 asks for two notifications: an install hint and a reload-on-update prompt.
- **Install hint: done** (`PwaInstallHint.tsx` + `lib/pwa-install.ts` — Chromium
  `beforeinstallprompt`, phones, one-time localStorage dismissal, the sanctioned
  device-scoped exception). Desktop is deliberately left to the browser's own
  install UI; note that in the PR and don't extend it.
- **Update notification: missing.** `vite.config.ts` has `registerType: 'autoUpdate'`
  and `main.tsx` calls `registerSW({ immediate: true })` — a new service worker
  activates silently and only applies on the next full navigation. A user in a
  long-lived tab or the installed PWA keeps running the old bundle indefinitely
  and never finds out. That undermines the iterate-in-production plan: fixes we
  ship don't reach open clients.

## 2. Design

### 2.1 Switch to prompt-mode updates
- `registerType: 'prompt'`; replace the bare `registerSW` call with the
  `useRegisterSW` hook (`virtual:pwa-register/react`) in an `UpdateNotice`
  component mounted once in the shell.
- **Never auto-reload.** Admin forms exist; a reload the user didn't ask for can
  eat input. The notice is passive until clicked.
- **Long-lived tabs must learn about updates:** in `onRegisteredSW`, poll
  `registration.update()` on an interval (60 min; constant, not config) and also
  on `visibilitychange` to visible — the installed-PWA case is "phone unlocks,
  app resumes", which is exactly when the check should happen.

### 2.2 The notice UI
- A small, calm banner/toast anchored above the bottom edge (must not overlap
  the assistant launcher position or the mobile tab bar): text
  `{de: "Neue Version verfügbar.", en: "New version available."}` + one action
  button `{de: "Neu laden", en: "Reload"}` calling
  `updateServiceWorker(true)`, + a dismiss (×) that hides it for this page
  load only (no persistence — next load is the new version anyway, and if the
  tab lives on, re-showing on the *next* detected update is correct).
- Design-system styled (tokens only, no new hex), `prefers-reduced-motion`
  respected, and a11y complete: the container is `role="status"` (polite — an
  update is not an emergency), the button and dismiss are real buttons with
  focus-visible rings and 44px targets at phone widths.
- i18n via the existing `t()`/locale plumbing; long German compound safe.

### 2.3 Testing seam (so the viewport suite can see it)
Playwright can't produce a real second SW version against one embedded binary.
Give the component one narrow seam: besides the hook state, `UpdateNotice`
listens for a `wolke:sw-need-refresh` CustomEvent on `window` and shows the
same UI (the reload button then falls back to a plain `location.reload()` when
there is no waiting worker). The seam is honest production code — tiny, typed,
and documented as the e2e trigger — not a dev-only fork.

## 3. Tests
- **Vitest**: notice hidden by default; shows on needRefresh; reload button
  calls `updateServiceWorker(true)`; dismiss hides without persisting; both
  locales; axe clean.
- **Playwright** (`e2e/update-notice.spec.ts`): dispatch the CustomEvent at all
  six viewports → notice visible, `expectViewportHealthy` incl. the open state,
  44px targets on phones, does not cover the tab bar / launcher corner; dismiss
  restores the clean layout. This satisfies CLAUDE.md's "new UI ships with
  viewport coverage".
- The real update path is verified manually and the steps documented in the PR:
  `make build`, serve, load; change any SPA file, rebuild, restart; within a
  poll interval (temporarily shorten it) or on visibility change the notice
  appears; clicking Reload lands the new bundle. Report honestly if any part
  can't be exercised.

## 4. Docs
- docs/02 §11.1 currently says the SW "auto-updates" — rewrite to describe
  prompt-based updates + the polling/visibility checks.
- One line in the README PWA/ops section: deploys reach open clients within an
  hour, or on next app resume, via the in-app reload notice.

## 5. Definition of done
- #42 closes. All gates green (`tsc`, vitest, `make e2e`, `go test -race`,
  lints). No regression to the auth-safe SW rules (docs/02 §11.1: `/api`,
  `/auth`, `/branding`, `/metrics` never cached — don't touch that block).
- `internal/web/dist` stays untracked (CLAUDE.md — build output is never
  committed).
