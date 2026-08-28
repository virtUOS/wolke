// Regression spec for https://github.com/virtUOS/wolke/issues/33
// "Unexpected empty space at the bottom of the app" — on a phone the sticky
// footer is pinned to the bottom of the viewport while the (deliberately short)
// mobile dashboard ends far above it, leaving a large dead band in between.
//
// Marked fixme until the fix lands; the fix's PR removes the annotation.

import { expect, test } from './fixtures'

/** How much slack between the last content and the footer still reads as layout, not a hole. */
const MAX_TRAILING_GAP = 96

test.use({ viewportChecks: [] })

test.describe('issue #33 — no dead space at the bottom', () => {
  test.skip(({ isMobile }) => isMobile !== true, 'reported for the phone layout')
  test.fixme(true, 'https://github.com/virtUOS/wolke/issues/33')

  test('the footer follows the content instead of being pushed to the bottom', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const measured = await page.evaluate(() => {
      const main = document.querySelector('main')!
      const footer = document.querySelector('footer')
      let lastContentBottom = 0
      for (const el of Array.from(main.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.bottom > lastContentBottom) lastContentBottom = r.bottom
      }
      return {
        lastContentBottom,
        footerTop: footer ? footer.getBoundingClientRect().top : main.getBoundingClientRect().bottom,
        viewportHeight: document.documentElement.clientHeight,
        documentScrollHeight: document.scrollingElement!.scrollHeight,
      }
    })

    const gap = measured.footerTop - measured.lastContentBottom
    expect(
      gap,
      `${Math.round(gap)}px of empty space between the last content (y ${Math.round(measured.lastContentBottom)}) ` +
        `and the footer (y ${Math.round(measured.footerTop)}) in a ${measured.viewportHeight}px viewport`,
    ).toBeLessThanOrEqual(MAX_TRAILING_GAP)

    // A short page must not be scrollable at all: scrolling into emptiness is
    // the other half of what the issue reports.
    expect(measured.documentScrollHeight).toBeLessThanOrEqual(measured.viewportHeight + 1)
  })
})
