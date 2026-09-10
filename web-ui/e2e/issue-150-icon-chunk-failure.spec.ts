// Regression for issue #150, in a real browser at every resolution in the
// matrix: a client whose deployment has moved on asks for a hashed chunk that
// no longer exists, and the dashboard must stay a dashboard.
//
// The chunk under test is the lazily loaded full lucide set. Only an icon
// outside the curated list pulls it (lib/icons), and the one seeded service
// with such an icon — "Zettelkasten Labor", flask-conical — is beta-tagged, so
// the flow turns the beta pref on. That is a real server write on the one
// shared test user, hence the same cross-worker lock (and the same
// always-restore) as service-visibility.spec.ts.
//
// Two behaviours in one navigation, because they happen together in
// production: the page reloads itself once (lib/pwa-update), and when the
// second attempt fails the same way, the icon's error boundary (lib/icons)
// renders the app-window fallback rather than unmounting the app.

import type { Page } from '@playwright/test'
import { withCrossWorkerLock } from './helpers/lock'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const BETA_SERVICE = /Zettelkasten Labor/

// Six workers may queue behind the lock, and this flow reloads a page.
test.setTimeout(120_000)

async function setBeta(page: Page, on: boolean) {
  const res = await page.request.patch('/api/me/prefs', { data: { show_beta: on } })
  expect(res.status(), `set show_beta=${on}`).toBe(200)
}

test('a chunk the deployment no longer has costs an icon, not the page', async ({ page }) => {
  await withCrossWorkerLock('visibility-beta', async () => {
    await setBeta(page, true)
    try {
      // The stale-shell shape: the shell references a chunk the server 404s.
      let chunkRequests = 0
      await page.route('**/assets/icon-set-*.js', (route) => {
        chunkRequests++
        return route.fulfill({ status: 404, body: 'gone' })
      })
      // Count main-frame navigations, so "reloads once" is asserted as a number
      // rather than assumed.
      let navigations = 0
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations++
      })

      await gotoApp(page, '/?tab=dienste')
      const main = page.getByRole('main')

      // The failed chunk really was requested, and the self-heal reload ran
      // exactly once — the guard holds even though the retry fails identically.
      await expect
        .poll(() => chunkRequests, { message: 'icon chunk requested' })
        .toBeGreaterThan(0)
      await expect
        .poll(() => navigations, { message: 'goto plus exactly one self-heal reload' })
        .toBe(2)
      // Let a would-be reload loop, and the failed import on the reloaded page,
      // show themselves before anything below is asserted.
      await page.waitForTimeout(1000)
      expect(navigations, 'no reload loop').toBe(2)

      // Only now is the page the settled, twice-failed one — the state that used
      // to be blank. The service whose icon is gone still renders, and so does
      // the rest of the catalog.
      await expect(main.getByRole('link', { name: BETA_SERVICE }).first()).toBeVisible()
      await expect(main.getByRole('link', { name: /BigBlueButton/ }).first()).toBeVisible()
      await expect(main.getByRole('link', { name: /Stud\.IP/ }).first()).toBeVisible()
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await setBeta(page, false)
    }
  })
})
