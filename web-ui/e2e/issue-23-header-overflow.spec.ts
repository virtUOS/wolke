// Regression spec for https://github.com/virtUOS/wolke/issues/23
// "View overflows on mobile" — the top bar is wider than a narrow phone, so the
// whole document scrolls sideways and the left edge of every screen is cut off.
//
// Marked fixme until the fix lands (the harness PR must merge green); the fix's
// PR removes the annotation. It asserts the overflow invariant itself rather
// than the full viewport health check, so it goes green with *this* fix and does
// not wait on the unrelated phone-width defects at the same width.

import { expectNoHorizontalOverflow } from './helpers/viewport'
import { expect, test } from './fixtures'

// Where it reproduces today: the bar's own content is 364px wide, so 324 and 360
// scroll sideways; at 390 the bar fits but the notification panel — anchored to
// the bell and 358px wide — hangs off the left edge. All three are the same
// defect (chrome sized for a desktop), so the block is annotated as one.
test.use({ viewportChecks: [] })

test.describe('issue #23 — the chrome fits the viewport', () => {
  test.fixme(({ isMobile }) => isMobile === true, 'https://github.com/virtUOS/wolke/issues/23')

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
