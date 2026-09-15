// Viewport + a11y spec for https://github.com/virtUOS/wolke/issues/174
// "Launcher: configurable institution-mark watermark in the app background".
//
// The mark is a fixed, aria-hidden, pointer-transparent box anchored to the
// bottom-right of the content column (issue #181; the viewport's corner below
// ~1180px) and hanging a third off both edges — which is to say it is
// *deliberately* partly outside the viewport, in a suite whose whole job is
// failing things that stick out past the viewport. Two properties of the
// harness keep those from colliding:
//
//   1. the DOM walk skips `[aria-hidden="true"]` subtrees (helpers/viewport.ts,
//      §5.1), so the mark is never probed for overflow;
//   2. a `position: fixed` box contributes nothing to the document's scrollable
//      overflow, so the document-scroll assertion is unaffected.
//
// Both are load-bearing and neither is obvious, so this spec pins them rather
// than leaving the suite green by luck: it turns the mark ON — it ships off —
// and then re-runs the standard assertions at every matrix resolution.
//
// Enabling it is done with page.route rather than a committed asset on purpose.
// The mark is branding *configuration*, not something this repo ships
// (CLAUDE.md golden rule 8), so there is no watermark.svg in `branding/` to
// point the suite at, and there must not be: the fixture below stands in for a
// deployment that mounted its own.

import type { Page } from '@playwright/test'
import { expectViewportHealthy } from './helpers/viewport'
import { expectNothingInvisibleAnnounced } from './helpers/a11y'
import { openSearch } from './helpers/search'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** A stand-in mark with the real one's 35:47 aspect ratio — a plain shape, no
 *  institution's anything. Only its alpha matters; the colour comes from the
 *  --accent token via the CSS mask. */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 47">
  <path fill="#000" d="M17.5 1 34 12v23L17.5 46 1 35V12Z"/>
</svg>`

const MARK_URL = '/branding/watermark.svg'

/** Turns the watermark on for this page, the way a deployment would: a
 *  branding.watermark value plus the asset it points at. */
async function enableWatermark(page: Page): Promise<void> {
  await page.route('**/api/branding', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ json: { ...body, watermark: MARK_URL } })
  })
  await page.route(`**${MARK_URL}`, async (route) => {
    await route.fulfill({ contentType: 'image/svg+xml', body: MARK_SVG })
  })
}

const watermark = (page: Page) => page.locator('.app-watermark')

/** The launcher's underline tab row (issue #170). Scoping to it matters on a
 *  phone: "Alle Dienste" also appears in the app bar's search pill
 *  ("Suchen: Alle Dienste durchsuchen"), so an unscoped name match is
 *  ambiguous there. */
const tabRow = (page: Page) =>
  page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })

const catalogTab = (page: Page) =>
  tabRow(page).getByRole('button', { name: /Alle Dienste|Services/i })

/** The content column's width — SHELL_MAX_WIDTH in DashboardShell.tsx. The
 *  number is restated here on purpose: the spec asserts the shipped geometry
 *  against the contract, not against whatever the bundle happens to export. */
const COLUMN_WIDTH = 1180

/**
 * The geometry rule since issue #181: the mark hangs a third off the bottom
 * edge of the viewport and a third off the RIGHT EDGE OF THE CONTENT COLUMN —
 * which is the viewport's right edge only while the column fills the viewport
 * (below ~1180px), and the column's own edge, (100vw + 1180) / 2, above that.
 * So the relationship between the mark and the cards is identical at 1280,
 * 1920 and 3440, instead of the mark drifting into the empty canvas as the
 * screen widens.
 *
 * Asserted at every matrix size and returned for the ultra-wide check below.
 */
async function expectAnchoredToColumn(page: Page): Promise<{ overlapsColumn: boolean }> {
  const g = await watermark(page).evaluate((node, column) => {
    const r = node.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const columnRight = Math.min(vw, (vw + column) / 2)
    const columnLeft = Math.max(0, (vw - column) / 2)
    return {
      width: r.width,
      height: r.height,
      // How far the box reaches past the anchor edge, as a share of its own size.
      overRight: (r.right - columnRight) / r.width,
      overBottom: (r.bottom - vh) / r.height,
      overlapsColumn: r.left < columnRight && r.right > columnLeft,
    }
  }, COLUMN_WIDTH)

  // "A third off both edges" has to hold at 324px, 1920px and 3440px alike —
  // that is the whole reason the offset is a transform on the element's own
  // box rather than a percentage right/bottom, which would resolve against the
  // viewport and drift with every screen size.
  expect(g.overRight, 'a third past the column\'s right edge').toBeCloseTo(0.33, 2)
  expect(g.overBottom, 'a third past the bottom edge').toBeCloseTo(0.33, 2)
  return { overlapsColumn: g.overlapsColumn }
}

/** The document's own horizontal overflow — what a user would scroll. */
async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test.describe('watermark off by default', () => {
  // The shipped configuration: no branding.watermark, so no element at all —
  // not a hidden one, not an empty one. This is the gate that keeps a missing
  // or unreachable mask file from ever mattering, so it is worth asserting
  // against the real server rather than a stub.
  test('renders no element when branding carries no mark', async ({ page }) => {
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(0)
  })
})

test.describe('watermark enabled', () => {
  test.beforeEach(async ({ page }) => {
    await enableWatermark(page)
  })

  test('hangs a third off the bottom-right of the content column without scrolling the document', async ({
    page,
  }, testInfo) => {
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)
    await expectAnchoredToColumn(page)

    // On a phone the mark is a corner accent, not a backdrop (issue #181):
    // 60vw wide, so the two thirds of it that are on screen take roughly a
    // quarter of the height — min(90vw, …) with the 35:47 aspect owned the
    // whole empty lower half of a tall phone under a short favourites list.
    if (testInfo.project.use.isMobile) {
      const m = await watermark(page).evaluate((node) => {
        const r = node.getBoundingClientRect()
        const vw = document.documentElement.clientWidth
        const vh = document.documentElement.clientHeight
        return { widthShare: r.width / vw, visibleHeightShare: (vh - r.top) / vh }
      })
      expect(m.widthShare).toBeCloseTo(0.6, 2)
      expect(m.visibleHeightShare, 'the on-screen part of the mark stays a corner accent').toBeLessThanOrEqual(0.3)
    }

    // …and hanging off the edge must not give the user anything to scroll.
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })

  // Issue #181: the matrix tops out at 1920, which is why a mark welded to the
  // viewport corner — hundreds of pixels from a 1180px column — went unnoticed
  // until a 3440px monitor. The geometry rule is therefore also checked well
  // above the matrix, once (one project, not six: the viewport is resized
  // inside the test, so the project's own size is irrelevant to it).
  test('keeps the same relationship to the column on an ultra-wide screen', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'desktop-1920', 'one ultra-wide check is enough')
    await page.setViewportSize({ width: 3440, height: 1440 })
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)
    const { overlapsColumn } = await expectAnchoredToColumn(page)
    // The point of anchoring to the column: on a wide screen the mark is back
    // under the cards, not floating alone in the empty canvas beside them.
    expect(overlapsColumn, 'the mark sits behind the content column, not beside it').toBe(true)
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('stays decorative: out of the a11y tree, out of the pointer\'s way, under the ceiling', async ({
    page,
  }) => {
    await gotoApp(page)
    const el = watermark(page)
    await expect(el).toHaveAttribute('aria-hidden', 'true')

    const style = await el.evaluate((node) => {
      const cs = getComputedStyle(node)
      return { opacity: Number(cs.opacity), pointerEvents: cs.pointerEvents, maskImage: cs.maskImage }
    })
    expect(style.pointerEvents).toBe('none')
    expect(style.opacity).toBeGreaterThan(0)
    expect(style.opacity).toBeLessThanOrEqual(0.08)
    // The mask URL is the configured one, never a constant baked into the SPA.
    expect(style.maskImage).toContain(MARK_URL)

    // Nothing at the corner responds to a click: whatever is under the pointer
    // there, it is not the mark.
    const hit = await page.evaluate(() => {
      const w = document.documentElement.clientWidth
      const h = document.documentElement.clientHeight
      const el = document.elementFromPoint(w - 4, h - 4)
      return el?.classList.contains('app-watermark') ?? false
    })
    expect(hit).toBe(false)

    // The accessibility tree announces nothing new (issue #35's assertion,
    // reused: a decorative element must add no announced content).
    await expectNothingInvisibleAnnounced(page, 'watermark enabled')
  })

  test('never paints over the app bar or the tab row', async ({ page }) => {
    await gotoApp(page)
    const markBox = await watermark(page).boundingBox()
    expect(markBox).not.toBeNull()

    // The app bar is clear at every matrix size by geometry: the mark's top
    // edge sits below it, because two thirds of an 859px mark on the shortest
    // desktop viewport still starts well under a 61px bar. (859px is the
    // mark's height at its 640px cap; the anchor moved to the column in
    // issue #181, which changes where the mark sits horizontally, not how
    // tall it is on a desktop.)
    const barBox = await page.getByRole('banner').boundingBox()
    expect(markBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height)

    // The tab row is a different story, and the issue's "bottom-right
    // anchoring guarantees it" does NOT hold for it: at 1280×720 — the
    // shortest desktop in the matrix — the mark's *box* is 859px tall on a
    // 720px viewport, so its top edge lands at y≈144, inside the tab row's
    // band (y 183–220). At every other matrix size it is clear. Measured, not
    // assumed; see the geometry note in the PR.
    //
    // What actually matters is therefore asserted directly rather than via the
    // box: the mark is painted BEHIND the chrome (z-index -1 inside the
    // canvas's isolated stacking context), so it can never obscure or
    // intercept either of them, at any size.
    const painted = await page.evaluate(() => {
      const at = (el: Element | null | undefined) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(
          Math.round(r.left + r.width / 2),
          Math.round(r.top + r.height / 2),
        )
        return hit?.closest('.app-watermark') !== null && hit?.closest('.app-watermark') !== undefined
      }
      return {
        overBar: at(document.querySelector('header')),
        overTabs: at(document.querySelector('main nav')),
      }
    })
    expect(painted.overBar).toBe(false)
    expect(painted.overTabs).toBe(false)
  })

  // The dark canvas is already 7% accent of the same token the mark is filled
  // with, and the mark is line art, so the value that reads as texture in light
  // reads as a drawing here. The split is asserted against the *rendered*
  // opacity, not just the constant, so a theme wired up wrongly fails.
  test.describe('in the dark theme', () => {
    test.use({ colorScheme: 'dark' })

    test('goes fainter than light, and still under the ceiling', async ({ page }) => {
      await gotoApp(page)
      const dark = await watermark(page).evaluate((n) => Number(getComputedStyle(n).opacity))
      expect(dark).toBeGreaterThan(0)
      expect(dark).toBeLessThan(0.07)
      expect(dark).toBeLessThanOrEqual(0.08)
    })
  })

  test('the full viewport matrix stays healthy on every launcher view', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)

    // Favoriten — the default landing view.
    await expect(watermark(page)).toHaveCount(1)
    await expectViewportHealthy(page, { isMobile, label: 'favorites + watermark' })
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)

    // Alle Dienste — the long view, where the list runs past the fold and the
    // fixed mark has to stay put without adding scroll width.
    await catalogTab(page).click()
    await expect(watermark(page)).toHaveCount(1)
    await expectViewportHealthy(page, { isMobile, label: 'catalog + watermark' })
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)

    // Search open — on a phone the revealed field sits inside the header at
    // z-20; the mark must not come near it.
    await openSearch(page)
    await expect(watermark(page)).toHaveCount(1)
    await expectViewportHealthy(page, { isMobile, label: 'search open + watermark' })
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('scrolling the list leaves the mark fixed to the viewport', async ({ page }) => {
    await gotoApp(page)
    await catalogTab(page).click()
    const before = await watermark(page).boundingBox()

    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    const after = await watermark(page).boundingBox()

    expect(after!.y).toBeCloseTo(before!.y, 0)
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })
})
