// Regression for issue #163, at the layer that failed: the service worker.
//
// #157 stopped the *server* answering a missing static path with the SPA shell
// (e2e/issue-156-missing-asset-404.spec.ts covers that side). But a controlled
// client never reaches the server for a navigation: Workbox's
// `navigateFallback` answers it from the precached shell, and its denylist
// covered only /api/, /auth/, /branding/, /metrics and /sw.js. So a bookmarked
// or shared asset URL got 200 + HTML from the worker — the same bug, one layer
// up. The fix mirrors isStaticFilePath (internal/web/web.go) in
// navigateFallbackDenylist (vite.config.ts).
//
// This is the one spec in the suite that deliberately runs *with* a service
// worker in control, so the assertion is about the worker's routing and not the
// server's. Module loads were never affected (NavigationRoute only matches
// `mode: 'navigate'`), which is why the #156 spec kept passing throughout.

import { expect, test } from './fixtures'
import { gotoApp } from './helpers/session'

/** Paths that must reach the server and 404, even with a worker in control. */
const STATIC_PATHS = ['/assets/does-not-exist.js', '/logo.png', '/some/deep/file.png']

// Registering the worker means a full precache download, and the flow
// navigates several times.
test.setTimeout(120_000)

test('the service worker answers a static path with a 404, not the shell', async ({ page }) => {
  await gotoApp(page)

  // The worker registers on load (components/UpdateNotice) and, with
  // `clientsClaim` off, only controls the *next* navigation.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true).catch(() => false)), {
      message: 'the service worker never became active',
      timeout: 30_000,
    })
    .toBe(true)
  await gotoApp(page)
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
    'the tab must be controlled, or this spec tests the server instead of the worker',
  ).toBe(true)

  for (const path of STATIC_PATHS) {
    const res = await page.goto(path)
    expect(res, `no response for ${path}`).not.toBeNull()
    expect(res!.status(), `${path} must be an honest 404, not the shell`).toBe(404)
    expect(res!.headers()['content-type'] ?? '', `${path} must never come back as HTML`).not.toMatch(/^text\/html/)
    expect(await res!.text(), `${path} returned the SPA shell`).not.toContain('<div id="root">')
  }

  // The fallback still does its job for what it is for: a client route, which
  // never carries a file extension, is served the shell — from the worker,
  // offline-capably, exactly as before.
  const route = await page.goto('/favorites')
  expect(route!.status(), 'a client route still gets the shell').toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
    'the client route was served while controlled',
  ).toBe(true)
})
