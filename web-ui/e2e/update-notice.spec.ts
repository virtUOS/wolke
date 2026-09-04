// The in-app "new version available" notice (issue #42) at every viewport.
//
// Playwright cannot produce a second service-worker version against one
// embedded binary, so the notice is triggered through its documented seam — the
// `wolke:sw-need-refresh` CustomEvent (src/lib/pwa-update.ts). Everything below
// the trigger is the real component in the real layout: same markup, same
// styles, same a11y semantics as a genuine update.

import { type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { gotoApp } from './helpers/session'
import { expectViewportHealthy } from './helpers/viewport'
import { expectNothingInvisibleAnnounced } from './helpers/a11y'

/** Mirrors the corner UpdateNotice reserves for the assistant launcher. */
const RESERVED_CORNER = 88

const NOTICE = 'Neue Version verfügbar.'

async function triggerUpdate(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('wolke:sw-need-refresh')))
}

test.describe('PWA update notice', () => {
  test('appears on a detected update and stays inside the viewport', async ({ page, isMobile }) => {
    await gotoApp(page)
    const notice = page.getByRole('status').filter({ hasText: NOTICE })
    await expect(notice).toHaveCount(0)

    await triggerUpdate(page)
    await expect(notice).toBeVisible()
    await expect(page.getByRole('button', { name: 'Neu laden' })).toBeVisible()

    // The open state is a state of its own: overflow, readability and (on
    // phones) 44px touch targets all have to hold with the notice up.
    await expectViewportHealthy(page, { isMobile, label: 'update notice shown' })
    await expectNothingInvisibleAnnounced(page, 'update notice shown')
  })

  test('covers neither the top bar nav nor the assistant launcher corner', async ({ page }) => {
    await gotoApp(page)
    await triggerUpdate(page)
    const notice = page.getByRole('status').filter({ hasText: NOTICE })
    await expect(notice).toBeVisible()

    const box = (await notice.boundingBox())!
    const nav = (await page.getByRole('navigation').first().boundingBox())!
    const overlapsNav =
      box.x < nav.x + nav.width && box.x + box.width > nav.x &&
      box.y < nav.y + nav.height && box.y + box.height > nav.y
    expect(overlapsNav, `the notice overlaps the top bar navigation (notice y ${Math.round(box.y)}, nav bottom ${Math.round(nav.y + nav.height)})`).toBe(false)

    const { width, height } = page.viewportSize()!
    expect(
      box.x + box.width,
      `the notice reaches into the ${RESERVED_CORNER}px bottom-right corner reserved for the assistant launcher`,
    ).toBeLessThanOrEqual(width - RESERVED_CORNER + 1)
    expect(box.y + box.height, 'the notice extends past the bottom edge').toBeLessThanOrEqual(height + 1)
  })

  // Issue #120: on desktop the click could visibly do nothing, because
  // vite-plugin-pwa only reloads from a `controllerchange` that an uncontrolled
  // tab never sees. The genuine update path can't be produced here (one
  // embedded binary, one worker version — see the seam note above), but the
  // guarantee the fix makes is testable through the seam: the click navigates.
  test('the Reload button navigates the page', async ({ page }) => {
    await gotoApp(page)
    await triggerUpdate(page)
    const notice = page.getByRole('status').filter({ hasText: NOTICE })
    await expect(notice).toBeVisible()

    // Survives only if the page is never navigated away from.
    await page.evaluate(() => {
      ;(window as unknown as { __beforeReload?: boolean }).__beforeReload = true
    })

    await page.getByRole('button', { name: 'Neu laden' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __beforeReload?: boolean }).__beforeReload ?? false), {
        message: 'the Reload click never navigated the page',
      })
      .toBe(false)
    await expect(notice).toHaveCount(0)
  })

  test('the dismiss control restores the clean layout', async ({ page, isMobile }) => {
    await gotoApp(page)
    await triggerUpdate(page)
    const notice = page.getByRole('status').filter({ hasText: NOTICE })
    await expect(notice).toBeVisible()

    await page.getByRole('button', { name: 'Hinweis schließen' }).click()
    await expect(notice).toHaveCount(0)
    await expectViewportHealthy(page, { isMobile, label: 'after dismissing the update notice' })
  })
})
