// Regression spec for https://github.com/virtUOS/wolke/issues/23
// "View overflows on mobile" — the top bar was wider than a narrow phone, so the
// whole document scrolled sideways and the left edge of every screen was cut off.
//
// It asserts the overflow invariant itself rather than the full viewport health
// check, so it stands on its own and does not wait on the unrelated phone-width
// defects at the same widths.

import { expectNoHorizontalOverflow } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

test.use({ viewportChecks: [] })

test.describe('issue #23 — the chrome fits the viewport', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('the top bar does not push the document into horizontal scroll', async ({ page }) => {
    const bar = page.locator('header > div').first()
    await expect(bar).toBeVisible()
    const barContentWidth = await bar.evaluate((el) => el.scrollWidth)
    const { viewportWidth, documentScrollWidth } = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.scrollingElement!.scrollWidth,
    }))
    expect(
      barContentWidth,
      `the top bar's content is ${barContentWidth}px wide in a ${viewportWidth}px viewport`,
    ).toBeLessThanOrEqual(viewportWidth + 1)
    expect(documentScrollWidth).toBeLessThanOrEqual(viewportWidth + 1)
  })

  test('the account menu opens without overflowing', async ({ page }) => {
    await page.getByRole('button', { name: /Konto-Menü|Account menu/i }).click()
    await expect(page.getByRole('dialog', { name: /Konto|Account/i })).toBeVisible()
    await expectNoHorizontalOverflow(page, 'account menu open')
  })

  test('the notification center opens without overflowing', async ({ page }) => {
    await page.getByRole('button', { name: /Mitteilungen|Notifications/i }).click()
    await expect(page.getByRole('dialog', { name: /Mitteilungen|Notifications/i })).toBeVisible()
    await expectNoHorizontalOverflow(page, 'notification center open')
  })
})
