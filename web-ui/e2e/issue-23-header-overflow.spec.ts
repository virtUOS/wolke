// Regression spec for https://github.com/virtUOS/wolke/issues/23
// "View overflows on mobile" — the top bar was wider than a narrow phone, so the
// whole document scrolled sideways and the left edge of every screen was cut off.
//
// It asserts the overflow invariant itself rather than the full viewport health
// check, so it stands on its own and does not wait on the unrelated phone-width
// defects at the same widths.

import { expectNoHorizontalOverflow } from './helpers/viewport'
import { expect, test } from './fixtures'

test.use({ viewportChecks: [] })

test.describe('issue #23 — the chrome fits the viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('the top bar does not push the document into horizontal scroll', async ({ page }) => {
    const measured = await page.evaluate(() => {
      const bar = document.querySelector('header > div') as HTMLElement
      return {
        viewportWidth: document.documentElement.clientWidth,
        barContentWidth: bar.scrollWidth,
        documentScrollWidth: document.scrollingElement!.scrollWidth,
      }
    })
    expect(
      measured.barContentWidth,
      `the top bar's content is ${measured.barContentWidth}px wide in a ${measured.viewportWidth}px viewport`,
    ).toBeLessThanOrEqual(measured.viewportWidth + 1)
    expect(measured.documentScrollWidth).toBeLessThanOrEqual(measured.viewportWidth + 1)
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
