// Viewport + a11y spec for https://github.com/virtUOS/wolke/issues/174
// "Launcher: configurable institution-mark watermark in the app background",
// with the geometry of issue #187 ("rebuild as a full-bleed backdrop").
//
// The mark is a fixed, aria-hidden, pointer-transparent box scaled from the
// viewport height, anchored to the right edge of the content column (issue
// #181; the viewport's edge below ~1180px) and cropped by the canvas edges —
// which is to say it is *deliberately* mostly outside the viewport, in a suite
// whose whole job is failing things that stick out past the viewport. Two
// properties of the harness keep those from colliding:
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
 * The geometry rule since issue #187, derived by overlaying the mark on the
 * two design references (see Watermark.tsx for the measurements):
 *
 *  - Desktop: the mark is 1.63× the viewport height, its top 28vh above the
 *    viewport, so it bleeds off the top AND the bottom; its right edge sits
 *    34% of its own width past the RIGHT EDGE OF THE CONTENT COLUMN — which is
 *    the viewport's right edge only while the column fills the viewport
 *    (below ~1180px), and the column's own edge, (100vw + 1180) / 2, above
 *    that (issue #181). So the relationship between the mark and the cards is
 *    identical at 1280, 1920 and 3440, instead of the mark drifting into the
 *    empty canvas as the screen widens.
 *  - Phone: 0.86× the viewport height, anchored at the bottom, bleeding 22% of
 *    its height off the bottom and 36% of its width off the right — and NOT
 *    off the top: it starts under the tab row, as on the mobile reference.
 *
 * Asserted at every matrix size and returned for the ultra-wide check below.
 */
const GEOMETRY = {
  desktop: { heightOverVh: 1.63, topOverVh: -0.28, overRight: 0.34 },
  mobile: { heightOverVh: 0.86, overBottom: 0.22, overRight: 0.36 },
} as const

async function expectBackdropGeometry(page: Page, isMobile: boolean): Promise<{ overlapsColumn: boolean }> {
  const g = await watermark(page).evaluate((node, column) => {
    const r = node.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const columnRight = Math.min(vw, (vw + column) / 2)
    const columnLeft = Math.max(0, (vw - column) / 2)
    return {
      vh,
      top: r.top,
      bottom: r.bottom,
      heightOverVh: r.height / vh,
      topOverVh: r.top / vh,
      // How far the box reaches past the anchor edge, as a share of its own size.
      overRight: (r.right - columnRight) / r.width,
      overBottom: (r.bottom - vh) / r.height,
      overlapsColumn: r.left < columnRight && r.right > columnLeft,
    }
  }, COLUMN_WIDTH)

  // The overhangs are transforms on the element's own box rather than
  // percentage right/bottom offsets, which would resolve against the viewport
  // and drift with every screen size — so they hold at 324px, 1920px and
  // 3440px alike.
  if (isMobile) {
    expect(g.heightOverVh, '0.86× the viewport height').toBeCloseTo(GEOMETRY.mobile.heightOverVh, 2)
    expect(g.overBottom, '22% of its height past the bottom edge').toBeCloseTo(GEOMETRY.mobile.overBottom, 2)
    expect(g.overRight, '36% of its width past the right edge').toBeCloseTo(GEOMETRY.mobile.overRight, 2)
    expect(g.top, 'on a phone the mark does not bleed off the top').toBeGreaterThan(0)
  } else {
    expect(g.heightOverVh, '1.63× the viewport height').toBeCloseTo(GEOMETRY.desktop.heightOverVh, 2)
    expect(g.topOverVh, '28vh above the top edge').toBeCloseTo(GEOMETRY.desktop.topOverVh, 2)
    expect(g.bottom, 'bleeds off the bottom edge').toBeGreaterThan(g.vh)
    expect(g.overRight, '34% of its width past the column\'s right edge').toBeCloseTo(GEOMETRY.desktop.overRight, 2)
  }
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

  test('is a backdrop scaled from the viewport height, cropped by the canvas edges, without scrolling the document', async ({
    page,
  }, testInfo) => {
    await gotoApp(page)
    await expect(watermark(page)).toHaveCount(1)
    await expectBackdropGeometry(page, testInfo.project.use.isMobile === true)

    // …and bleeding off the edges must not give the user anything to scroll.
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
    const { overlapsColumn } = await expectBackdropGeometry(page, false)
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
    await expect(watermark(page)).toHaveCount(1)

    // Since issue #187 the mark's *box* deliberately reaches behind the app bar
    // and the tab row — on a desktop it bleeds off the top edge — so there is
    // no geometric "clear of the chrome" to assert any more, and there never
    // reliably was one (at 1280×720 the old box already reached the tab row).
    // What actually matters is asserted directly: the mark is painted BEHIND
    // the chrome (z-index -1 inside the canvas's isolated stacking context),
    // so it can never obscure or intercept either of them, at any size.
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

  // Issue #187: with the desktop cards opaque, the mark crosses no card text on
  // a desktop — and on a phone, where the list rows stay transparent and the
  // mark shows through them, 7% of the accent over the canvas must leave the
  // row text at AA.
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
      await watermark(page).evaluate((node) => {
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
  // constant, so a theme wired up wrongly fails. Issue #187 put both themes
  // back on the references' 7%: the dark compensation of #181 existed to stop
  // the mark competing with card text it crossed, and the opaque cards mean it
  // crosses none.
  test.describe('in the dark theme', () => {
    test.use({ colorScheme: 'dark' })

    test('renders at the same 0.07 as light, under the ceiling', async ({ page }) => {
      await gotoApp(page)
      const dark = await watermark(page).evaluate((n) => Number(getComputedStyle(n).opacity))
      expect(dark).toBeCloseTo(0.07, 3)
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
