// Regression spec for https://github.com/virtUOS/wolke/issues/33
// "Unexpected empty space at the bottom of the app" — on a phone the sticky
// footer was pinned to the bottom of the viewport while the (deliberately short)
// mobile dashboard ended far above it, leaving a large dead band in between.

import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** How much slack between the last content and the footer still reads as layout, not a hole. */
const MAX_TRAILING_GAP = 96
/** Rounding slack for the document-height check. */
const TRAILING_SLACK = 2

test.use({ viewportChecks: [] })

test.describe('issue #33 — no dead space at the bottom', () => {
  test.skip(({ isMobile }) => isMobile !== true, 'reported for the phone layout')

  test('the footer follows the content instead of being pushed to the bottom', async ({ page }) => {
    await gotoApp(page)

    const measured = await page.evaluate(() => {
      const main = document.querySelector('main')!
      const footer = document.querySelector('footer')
      let lastContentBottom = 0
      for (const el of Array.from(main.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.bottom > lastContentBottom) lastContentBottom = r.bottom
      }
      const bottomMost = footer ?? main
      return {
        lastContentBottom,
        footerTop: footer ? footer.getBoundingClientRect().top : main.getBoundingClientRect().bottom,
        // In document coordinates, so it is comparable to scrollHeight.
        contentBottom: bottomMost.getBoundingClientRect().bottom + window.scrollY,
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

    // And there is nothing to scroll *past* the content: the document may be as
    // tall as the viewport (the canvas fills it with background, which is the
    // point) or as tall as its content, but not taller than both. A canvas sized
    // in `vh` rather than `dvh` fails this on a real mobile browser, where 100vh
    // exceeds the visible viewport by the height of the URL bar.
    const allowed = Math.max(measured.viewportHeight, measured.contentBottom) + TRAILING_SLACK
    expect(
      measured.documentScrollHeight,
      `the document is ${Math.round(measured.documentScrollHeight)}px tall with content ending at ` +
        `${Math.round(measured.contentBottom)}px in a ${measured.viewportHeight}px viewport`,
    ).toBeLessThanOrEqual(allowed)
  })
})
