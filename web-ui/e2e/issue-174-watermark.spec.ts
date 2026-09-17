// Viewport + a11y spec for https://github.com/virtUOS/wolke/issues/174
// "Launcher: configurable institution-mark watermark in the app background",
// with the geometry of issue #195 ("column-anchored mark with a right-gutter
// fade", design board turn 9). See docs/specs/watermark-column-fade.md.
//
// The mark is a fixed, aria-hidden, pointer-transparent layer whose content is
// anchored to the content column horizontally and to the greeting vertically,
// and which dissolves into the 360px of gutter right of the column — which is
// to say it is *deliberately* partly outside the viewport, in a suite whose
// whole job is failing things that stick out past the viewport. Two properties
// of the harness keep those from colliding:
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
 *  --accent token via the CSS mask. It is deliberately a *solid* hexagon: a
 *  horizontal line through its middle has ink at every x, which is what lets
 *  the gutter-fade test below read the gradient off the rendered pixels. */
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

/** One announcement, so the banner mounts — the layout change the vertical
 *  anchor is specified against. */
async function withAnnouncement(page: Page): Promise<void> {
  await page.route('**/api/announcements', async (route) => {
    await route.fulfill({
      json: {
        announcements: [
          {
            id: 'e2e-1',
            title: { de: 'Wartungsankündigung', en: 'Maintenance notice' },
            body: { de: 'HISinOne ist am Samstag nicht erreichbar.', en: 'HISinOne is unavailable on Saturday.' },
            severity: 'info',
            audience: { kind: 'all' },
            dismissible: true,
          },
        ],
      },
    })
  })
}

const layer = (page: Page) => page.locator('.app-watermark-layer')
const watermark = (page: Page) => page.locator('.app-watermark')
const greeting = (page: Page) => page.getByRole('heading', { level: 1 })

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
 * The geometry rule since issue #195, as ratios of the column width C — the
 * handoff's pixels assume a 960px column, ours is 1180, so only ratios carry:
 *
 *  - width  = 0.65 × C (767px), height from the 35:47 ratio (≈1030px)
 *  - the mark's right edge sits 38% of its OWN width past the column's right
 *    edge (right: −0.247 × C)
 *  - top = the greeting's top, measured
 *  - the whole layer fades linearly to transparent over the 360px right of the
 *    column, so nothing floats in the empty canvas of a wide screen and
 *    nothing reads as a truncated image (#193's failure)
 *
 * Nothing here is viewport-derived, which is the point: the rule is identical
 * at 1280, 1920, 2560 and 3440.
 */
const GEOMETRY = {
  widthRatio: 0.65,
  overRight: 0.38,
  aspect: 47 / 35,
  gutterFade: 360,
} as const

/** The phone geometry of issue #181, deliberately untouched by #195. */
const MOBILE_GEOMETRY = { heightOverVh: 0.86, overBottom: 0.22, overRight: 0.36 } as const

async function expectColumnGeometry(page: Page): Promise<{ overlapsColumn: boolean }> {
  const g = await watermark(page).evaluate((node, column) => {
    const r = node.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    // The column wrapper is `max-width: C; margin: 0 auto`, so below C the
    // column IS the viewport — which is exactly the anchor the mark should
    // hang off there. Above C it is the centred column's own edge.
    const columnRight = Math.min(vw, (vw + column) / 2)
    const columnLeft = Math.max(0, (vw - column) / 2)
    return {
      width: r.width,
      height: r.height,
      top: r.top,
      // How far the box reaches past the column's right edge, as a share of
      // its own width. The column's edge, NOT the viewport's: they agree only
      // while the column fills the screen.
      overRight: (r.right - columnRight) / r.width,
      overlapsColumn: r.left < columnRight && r.right > columnLeft,
    }
  }, COLUMN_WIDTH)

  expect(g.width, '0.65 × the column width').toBeCloseTo(COLUMN_WIDTH * GEOMETRY.widthRatio, 0)
  expect(g.height, 'height from the 35:47 ratio').toBeCloseTo(g.width * GEOMETRY.aspect, 0)
  expect(g.overRight, "38% of its own width past the column's right edge").toBeCloseTo(GEOMETRY.overRight, 2)
  return { overlapsColumn: g.overlapsColumn }
}

async function expectMobileGeometry(page: Page): Promise<void> {
  const g = await watermark(page).evaluate((node) => {
    const r = node.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    return {
      top: r.top,
      heightOverVh: r.height / vh,
      overRight: (r.right - vw) / r.width,
      overBottom: (r.bottom - vh) / r.height,
    }
  })
  expect(g.heightOverVh, '0.86× the viewport height').toBeCloseTo(MOBILE_GEOMETRY.heightOverVh, 2)
  expect(g.overBottom, '22% of its height past the bottom edge').toBeCloseTo(MOBILE_GEOMETRY.overBottom, 2)
  expect(g.overRight, '36% of its width past the right edge').toBeCloseTo(MOBILE_GEOMETRY.overRight, 2)
  expect(g.top, 'on a phone the mark does not bleed off the top').toBeGreaterThan(0)
}

/** The document's own horizontal overflow — what a user would scroll. */
async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** Reads the rendered colour at a list of viewport points out of one
 *  screenshot (there is no PNG library on the Node side, so the decode happens
 *  in the page). Points are in CSS pixels; the deviceScaleFactor is handled. */
async function samplePixels(page: Page, points: { x: number; y: number }[]): Promise<number[][]> {
  const shot = (await page.screenshot()).toString('base64')
  return page.evaluate(
    async ({ shot, points }) => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = `data:image/png;base64,${shot}`
      })
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const scale = img.width / document.documentElement.clientWidth
      return points.map(({ x, y }) => {
        const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data
        return [d[0], d[1], d[2]]
      })
    },
    { shot, points },
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
    await expect(layer(page)).toHaveCount(0)
  })
})

test.describe('watermark enabled', () => {
  test.beforeEach(async ({ page }) => {
    await enableWatermark(page)
  })

  test('is anchored to the content column, not the viewport, without scrolling the document', async ({
    page,
  }, testInfo) => {
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)
    if (testInfo.project.use.isMobile === true) {
      await expectMobileGeometry(page)
    } else {
      await expectColumnGeometry(page)
    }

    // …and hanging off the column edge must not give the user anything to
    // scroll.
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })

  // The vertical half of #195's rule. The handoff's 112px/62px pair is a
  // fallback; what ships is a measurement, so this asserts against the
  // greeting's real position — with and without the announcement banner, the
  // layout change the design calls out.
  test.describe('vertical anchor', () => {
    test('starts at the greeting, not at a viewport fraction', async ({ page }, testInfo) => {
      testInfo.skip(testInfo.project.use.isMobile === true, 'the phone mark is bottom-anchored (#181)')
      await gotoApp(page)
      const markTop = (await watermark(page).boundingBox())!.y
      const greetingTop = (await greeting(page).boundingBox())!.y
      expect(markTop, "the mark's top is the greeting's top").toBeCloseTo(greetingTop, 0)
      // And it is never cropped at the top, at any height in the matrix.
      expect(markTop).toBeGreaterThan(0)
    })

    test('follows the greeting when the announcement banner mounts', async ({ page }, testInfo) => {
      testInfo.skip(testInfo.project.use.isMobile === true, 'the phone mark is bottom-anchored (#181)')
      await withAnnouncement(page)
      await gotoApp(page)
      await expect(page.getByText(/Wartungsank/)).toBeVisible()
      const markTop = (await watermark(page).boundingBox())!.y
      const greetingTop = (await greeting(page).boundingBox())!.y
      // The point of measuring rather than hardcoding: whatever the banner
      // does to the column, the two stay equal. (In this launcher the banner
      // sits *below* the greeting, so neither moves — the assertion is that
      // they agree, not that they changed.)
      expect(markTop).toBeCloseTo(greetingTop, 0)
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
    })
  })

  // Issue #181: the matrix tops out at 1920, which is why a mark welded to the
  // viewport corner — hundreds of pixels from a 1180px column — went unnoticed
  // until a 3440px monitor. Every predecessor of this rule failed above the
  // matrix, so the rule is checked there explicitly, at both the 21:9 the
  // design board rendered (2560) and the ultrawide that caught #181 (3440).
  for (const { width, height } of [
    { width: 2560, height: 1080 },
    { width: 3440, height: 1440 },
  ]) {
    test(`keeps the same relationship to the column at ${width}×${height}`, async ({ page }, testInfo) => {
      testInfo.skip(testInfo.project.name !== 'desktop-1920', 'one project drives the above-matrix widths')
      await page.setViewportSize({ width, height })
      await gotoApp(page)
      await expect(watermark(page)).toHaveCount(1)
      const { overlapsColumn } = await expectColumnGeometry(page)
      // The point of anchoring to the column: on a wide screen the mark is
      // back under the cards, not floating alone in the empty canvas.
      expect(overlapsColumn, 'the mark sits behind the content column, not beside it').toBe(true)
      expect(await documentOverflow(page)).toBeLessThanOrEqual(0)

      const markTop = (await watermark(page).boundingBox())!.y
      expect(markTop).toBeCloseTo((await greeting(page).boundingBox())!.y, 0)
    })
  }

  // The gutter fade is the whole idea of turn 9, and it is the thing a CSS
  // refactor could silently drop (a dropped mask leaves a *harder* looking
  // mark, not a broken page). So it is asserted on rendered pixels, above the
  // matrix, where the entire fade fits on screen.
  test('dissolves across the gutter instead of being cut off', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'desktop-1920', 'the full 360px fade only fits above the matrix')
    await page.setViewportSize({ width: 2560, height: 1080 })
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)

    const box = (await watermark(page).boundingBox())!
    const columnRight = (2560 + COLUMN_WIDTH) / 2
    // A horizontal line through the middle of the stand-in hexagon: it has ink
    // at every x there, so anything that varies along it is the gradient.
    const y = Math.round(box.y + box.height / 2)
    const xs = [columnRight - 40, columnRight + 20, columnRight + 150, columnRight + 280]
    // …and one reference point on bare canvas, left of the mark entirely.
    const reference = { x: 40, y }
    const samples = await samplePixels(page, [...xs.map((x) => ({ x: Math.round(x), y })), reference])
    const canvas = samples.pop()!
    // Blue is the channel the accent moves most against either canvas.
    const ink = samples.map((p) => Math.abs(p[2] - canvas[2]))

    expect(y, 'the sampled line is on screen').toBeLessThan(1080)
    expect(ink[0], 'the mark is at full strength over the column').toBeGreaterThan(8)
    // Strictly decreasing across the gutter, and gone by its far end.
    expect(ink[1]).toBeLessThan(ink[0] + 1)
    expect(ink[2], 'half way across the gutter it is weaker').toBeLessThan(ink[1])
    expect(ink[3], 'at the far end of the gutter it is nearly gone').toBeLessThan(ink[2])
    expect(ink[3], 'and it really is nearly gone, not merely weaker').toBeLessThanOrEqual(2)
    // The fade ends inside the gutter, so nothing of the mark survives past it.
    expect(box.x + box.width).toBeLessThan(columnRight + GEOMETRY.gutterFade)
  })

  // Issue #199: the test above is the whole reason this pair exists. It asserts
  // the fade at 2560, the one width where the full 360px happens to fit — and
  // for as long as that was the only assertion, the fade could be (and was) a
  // no-op everywhere below ~1900px without anything going red. A rule checked
  // only where it holds is not checked.
  //
  // So both stated behaviours are pinned, at the width each one is the rule at:
  //
  //   1280 — there IS a gutter (50px of it), so the fade completes in it.
  //    768 — the viewport is narrower than the content column, so there is NO
  //          gutter, and the mark bleeds off the edge. Deliberately: the clamp
  //          fills the gutter that exists, it does not invent room.
  //
  // Both read the rendered pixels at the screen's last column, because that is
  // where the two differ and where a regression would show.

  /** The blue delta of the mark's ink against the bare canvas, sampled along a
   *  horizontal line through the middle of the stand-in hexagon (it has ink at
   *  every x there, so anything that varies along the line is the mask). */
  async function inkAlongTheMark(page: Page, xs: number[]): Promise<number[]> {
    const box = (await watermark(page).boundingBox())!
    const y = Math.round(box.y + box.height / 2)
    const vh = await page.evaluate(() => document.documentElement.clientHeight)
    expect(y, 'the sampled line is on screen').toBeLessThan(vh)
    const samples = await samplePixels(page, [...xs.map((x) => ({ x: Math.round(x), y })), { x: 40, y }])
    const canvas = samples.pop()!
    return samples.map((p) => Math.abs(p[2] - canvas[2]))
  }

  test('completes the fade inside the narrow gutter of a 1280 screen', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'desktop-1280', 'this is the 1280 case')
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)

    const vw = await page.evaluate(() => document.documentElement.clientWidth)
    const columnRight = (vw + COLUMN_WIDTH) / 2
    const gutter = vw - columnRight
    expect(gutter, 'at 1280 the gutter is a fraction of the 360px the rule asks for').toBeLessThan(
      GEOMETRY.gutterFade,
    )
    // Well inside the column, then across the gutter to the screen's last pixel.
    const ink = await inkAlongTheMark(page, [columnRight - 40, columnRight + gutter / 2, vw - 1])

    expect(ink[0], 'full strength over the column').toBeGreaterThan(8)
    expect(ink[1], 'weaker half way across the gutter').toBeLessThan(ink[0])
    // The point of the whole issue: the mark reaches transparent BEFORE the
    // screen edge cuts it, even though the gutter is 50px rather than 360.
    expect(ink[2], 'and gone at the screen edge — dissolved, not cut').toBeLessThanOrEqual(1)
  })

  test('bleeds off the edge where the viewport is narrower than the column', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'tablet-768', 'the widest viewport that is narrower than the column')
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)

    const vw = await page.evaluate(() => document.documentElement.clientWidth)
    expect(vw, 'this width is below the column cap, which is what makes it the bleed case').toBeLessThan(
      COLUMN_WIDTH,
    )
    // 768 is the desktop layout (MOBILE_BREAKPOINT_PX is a min-width), so this
    // is the desktop geometry, not #181's phone rule — the mark runs past the
    // right edge with no gutter behind it to dissolve into.
    const box = (await watermark(page).boundingBox())!
    expect(box.x + box.width, 'the mark reaches past the viewport').toBeGreaterThan(vw)

    const ink = await inkAlongTheMark(page, [vw / 2, vw - 1])
    expect(ink[0], 'full strength over the column').toBeGreaterThan(8)
    // Asserted, not tolerated: with no gutter there is nothing to fade over, so
    // the mark meets the edge at full strength and bleeds — the same thing the
    // phone rule does on purpose. If this ever goes to zero, the fade has been
    // keyed to something that eats into the column itself.
    expect(ink[1], 'still at full strength where the screen ends').toBeGreaterThan(8)
    expect(ink[1], 'i.e. it bleeds rather than dissolving').toBeCloseTo(ink[0], -1)
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('stays decorative: out of the a11y tree, out of the pointer\'s way, under the ceiling', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)
    const el = watermark(page)
    await expect(layer(page)).toHaveAttribute('aria-hidden', 'true')
    await expect(el).toHaveAttribute('aria-hidden', 'true')

    const style = await el.evaluate((node) => {
      const cs = getComputedStyle(node)
      return { opacity: Number(cs.opacity), pointerEvents: cs.pointerEvents, maskImage: cs.maskImage }
    })
    expect(style.pointerEvents).toBe('none')
    expect(style.opacity).toBeGreaterThan(0)
    // Light's value is a decided departure from the board's dark-derived 0.08
    // cap (issue #195, C1); it is still far below anything that could compete
    // with content.
    expect(style.opacity).toBeLessThanOrEqual(0.15)
    // The mask URL is the configured one, never a constant baked into the SPA.
    expect(style.maskImage).toContain(MARK_URL)

    // The layer reads the column width from the one variable that publishes
    // it, and carries the gutter gradient — on a desktop. On a phone the
    // column IS the viewport, so a gradient keyed to the column edge would
    // fade the mark out over its own anchor; there is deliberately none.
    const layerStyle = await layer(page).evaluate((node) => ({
      mask: getComputedStyle(node).maskImage,
      column: getComputedStyle(node).getPropertyValue('--launcher-max-width').trim(),
    }))
    expect(layerStyle.column).toBe(`${COLUMN_WIDTH}px`)
    if (isMobile) {
      expect(layerStyle.mask).toBe('none')
    } else {
      expect(layerStyle.mask).toContain('linear-gradient')
    }

    // Nothing at the corner responds to a click: whatever is under the pointer
    // there, it is not the mark.
    const hit = await page.evaluate(() => {
      const w = document.documentElement.clientWidth
      const h = document.documentElement.clientHeight
      const el = document.elementFromPoint(w - 4, h - 4)
      return el?.closest('.app-watermark-layer') !== null && el?.closest('.app-watermark-layer') !== undefined
    })
    expect(hit).toBe(false)

    // The accessibility tree announces nothing new (issue #35's assertion,
    // reused: a decorative element must add no announced content).
    await expectNothingInvisibleAnnounced(page, 'watermark enabled')
  })

  test('never paints over the app bar or the tab row', async ({ page }) => {
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)

    // The mark's *box* deliberately reaches behind the app bar and the tab row
    // — anchored to the greeting, it starts level with the tab row on a
    // desktop — so there is no geometric "clear of the chrome" to assert, and
    // there never reliably was one. What actually matters is asserted
    // directly: the mark is painted BEHIND the chrome (z-index -1 inside the
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
        return hit?.closest('.app-watermark-layer') !== null && hit?.closest('.app-watermark-layer') !== undefined
      }
      return {
        overBar: at(document.querySelector('header')),
        overTabs: at(document.querySelector('main nav')),
      }
    })
    expect(painted.overBar).toBe(false)
    expect(painted.overTabs).toBe(false)
  })

  // Issue #187: with the desktop cards opaque, the mark crosses no card text on
  // a desktop — and on a phone, where the list rows stay transparent and the
  // mark shows through them, the accent over the canvas must leave the row text
  // at AA.
  test.describe('text contrast', () => {
    test('desktop: the fill of a card the mark passes behind is pixel-identical with the mark on and off', async ({
      page,
    }, testInfo) => {
      testInfo.skip(testInfo.project.use.isMobile === true, 'the grid card is the desktop layout')
      await gotoApp(page)
      await expect(watermark(page)).toHaveCount(1)

      // A card that the mark's box actually reaches — otherwise the comparison
      // proves nothing. On the desktop sizes that is the right-hand end of the
      // favourites row.
      const markBox = (await watermark(page).boundingBox())!
      const cards = page.locator('.tile-grid')
      const n = await cards.count()
      let index = -1
      for (let i = 0; i < n; i++) {
        const b = (await cards.nth(i).boundingBox())!
        if (b.x + b.width > markBox.x && b.x < markBox.x + markBox.width) {
          index = i
          break
        }
      }
      expect(index, 'no grid card lies under the mark').toBeGreaterThanOrEqual(0)
      const card = cards.nth(index)

      // The card interior, inset past the rounded corners (the canvas — and
      // the mark — show in the corner pixels outside the border radius), and
      // the boxes of everything drawn ON the fill: glyphs and icons are
      // re-rasterised when a composited layer toggles and can differ by a few
      // levels for reasons that have nothing to do with the mark, so the
      // comparison is of the bare fill between them. A stroke showing through
      // would cross that fill.
      const { clip, exclude } = await card.evaluate((node) => {
        const r = node.getBoundingClientRect()
        const flat = (b: DOMRect) => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom })
        const boxes = Array.from(node.querySelectorAll('svg, span, p, a, button, div[aria-hidden]'))
          .map((el) => el.getBoundingClientRect())
          // …but not the full-coverage launch link, which is the whole card.
          .filter((b) => b.width * b.height < 0.5 * r.width * r.height)
          .map(flat)
        return {
          clip: { x: r.left + 6, y: r.top + 6, width: r.width - 12, height: r.height - 12 },
          exclude: boxes,
        }
      })

      // Both captures come from the same page load — the mark is switched off
      // in place — so the only thing that can differ between them is the mark.
      // A comparison across two loads would also pick up whatever a parallel
      // worker's clicks did to the layout in between.
      const withMark = await page.screenshot({ clip })
      const wholeWithMark = await page.screenshot()
      await layer(page).evaluate((node) => {
        node.style.display = 'none'
      })
      const withoutMark = await page.screenshot({ clip })
      const wholeWithoutMark = await page.screenshot()

      // Sanity: the mark does paint *somewhere* on this page, or the identity
      // below would prove nothing.
      expect(wholeWithMark.equals(wholeWithoutMark), 'the mark paints nothing at all').toBe(false)

      // Decode and compare in the page (no PNG library on the Node side).
      const result = await page.evaluate(
        async ({ on, off, clip, exclude }) => {
          const load = (b64: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image()
              img.onload = () => resolve(img)
              img.onerror = reject
              img.src = `data:image/png;base64,${b64}`
            })
          const [a, b] = await Promise.all([load(on), load(off)])
          const w = a.width
          const h = a.height
          const scale = w / clip.width
          const pixels = (img: HTMLImageElement) => {
            const c = document.createElement('canvas')
            c.width = w
            c.height = h
            const ctx = c.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            return ctx.getImageData(0, 0, w, h).data
          }
          const da = pixels(a)
          const db = pixels(b)
          const margin = 2
          let compared = 0
          let differing = 0
          let maxDelta = 0
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const cx = clip.x + x / scale
              const cy = clip.y + y / scale
              if (exclude.some((r) => cx >= r.left - margin && cx <= r.right + margin && cy >= r.top - margin && cy <= r.bottom + margin)) continue
              compared++
              const k = (y * w + x) * 4
              const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]))
              if (d > 0) {
                differing++
                maxDelta = Math.max(maxDelta, d)
              }
            }
          }
          return { compared, differing, maxDelta }
        },
        { on: withMark.toString('base64'), off: withoutMark.toString('base64'), clip, exclude },
      )
      expect(result.compared, 'nothing left to compare').toBeGreaterThan(1000)
      expect(
        result.differing,
        `the mark changed ${result.differing} fill pixels of ${result.compared} (max delta ${result.maxDelta})`,
      ).toBe(0)
    })

    test('phone: the row text stays at AA against the canvas with the mark composited over it', async ({
      page,
    }, testInfo) => {
      testInfo.skip(testInfo.project.use.isMobile !== true, 'the transparent list row is the phone layout')
      await gotoApp(page)
      await expect(watermark(page)).toHaveCount(1)
      await expect(page.locator('.tile-list-item').first()).toBeVisible()

      const ratios = await page.evaluate(() => {
        // sRGB channel parsing for the two forms Chromium hands back:
        // rgb(a)(…) and color(srgb r g b [/ a]).
        const parse = (css: string): [number, number, number, number] => {
          let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(css)
          if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] === undefined ? 1 : Number(m[4])]
          m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(css)
          if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
          throw new Error(`unparsed colour: ${css}`)
        }
        const lum = ([r, g, b]: number[]) => {
          const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
        }
        const contrast = (a: number[], b: number[]) => {
          const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
          return (l1 + 0.05) / (l2 + 0.05)
        }
        const canvas = parse(getComputedStyle(document.querySelector('.app-canvas')!).backgroundColor)
        const mark = document.querySelector<HTMLElement>('.app-watermark')!
        const accent = parse(getComputedStyle(mark).backgroundColor)
        const o = Number(getComputedStyle(mark).opacity)
        // The worst case behind a row's text: a stroke of the mark, i.e. the
        // accent at its opacity composited over the canvas.
        const composited = canvas.map((c, i) => (i === 3 ? 1 : c * (1 - o) + accent[i] * o))
        const row = document.querySelector('.tile-list-item')!
        const rowBg = parse(getComputedStyle(row).backgroundColor)
        const texts = [
          row.querySelector<HTMLElement>('.hyphenate-compound')!,
          row.querySelector<HTMLElement>('p')!,
        ].map((el) => parse(getComputedStyle(el).color))
        return {
          rowAlpha: rowBg[3],
          onCanvas: texts.map((t) => contrast(t, canvas)),
          onMark: texts.map((t) => contrast(t, composited)),
        }
      })
      // The row really is transparent — the mark does show through it.
      expect(ratios.rowAlpha).toBe(0)
      for (const r of ratios.onCanvas) expect(r).toBeGreaterThanOrEqual(4.5)
      for (const r of ratios.onMark) expect(r).toBeGreaterThanOrEqual(4.5)
    })
  })

  // The rendered opacity is asserted in a dark browser context, not just the
  // constant, so a theme wired up wrongly fails. Issue #195 splits the two
  // themes: dark keeps the board's 0.07 under its 0.08 cap, light is lifted
  // because the same value measures Δ9 there against dark's Δ15.
  test.describe('in the dark theme', () => {
    test.use({ colorScheme: 'dark' })

    test('renders at the board\'s 0.07, under the ceiling that value defined', async ({ page }) => {
      await gotoApp(page)
      const dark = await watermark(page).evaluate((n) => Number(getComputedStyle(n).opacity))
      expect(dark).toBeCloseTo(0.07, 3)
      expect(dark).toBeLessThanOrEqual(0.08)
    })

    test('keeps the column geometry: the rule is not theme-dependent', async ({ page }, testInfo) => {
      testInfo.skip(testInfo.project.use.isMobile === true, 'the column rule is the desktop one')
      await gotoApp(page)
      await expectColumnGeometry(page)
    })
  })

  test('renders more faintly in light than in dark, which is what keeps them equally visible', async ({
    page,
  }) => {
    await gotoApp(page)
    const light = await watermark(page).evaluate((n) => Number(getComputedStyle(n).opacity))
    expect(light).toBeCloseTo(0.15, 3)
    // Deliberately above the board's cap; see docs/specs/watermark-column-fade.md §3.
    expect(light).toBeGreaterThan(0.07)
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

  test('the announcement banner keeps the matrix healthy with the mark on', async ({ page }, testInfo) => {
    await withAnnouncement(page)
    await gotoApp(page)
    await expect(page.getByText(/Wartungsank/)).toBeVisible()
    await expect(watermark(page)).toHaveCount(1)
    await expectViewportHealthy(page, {
      isMobile: testInfo.project.use.isMobile === true,
      label: 'announcement + watermark',
    })
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('scrolling the list leaves the mark fixed to the viewport', async ({ page }) => {
    // The deliberate consequence of a fixed layer anchored to an in-flow
    // element: they agree at scroll-top — the state the composition is
    // designed in — and the mark then stays put while the list scrolls, which
    // is what keeps a ~1030px box out of the document's scrollable overflow.
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

// A branding payload that predates the watermark field — the shape a client
// genuinely holds for up to five minutes after a deploy, since /api/branding is
// public with max-age=300. The launcher has no error boundary above it, so a
// throw here is a blank page, not a missing decoration.
test('a branding payload without the watermark field still renders the launcher', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/branding', async (route) => {
    const res = await route.fetch()
    const stale = (await res.json()) as Record<string, unknown>
    delete stale.watermark
    await route.fulfill({ json: stale })
  })

  await gotoApp(page)
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.locator('.app-watermark')).toHaveCount(0)
  expect(errors, 'the stale payload must not throw during render').toEqual([])
  await expectViewportHealthy(page, {
    isMobile: testInfo.project.use.isMobile === true,
    label: 'launcher on a pre-watermark branding payload',
  })
})
