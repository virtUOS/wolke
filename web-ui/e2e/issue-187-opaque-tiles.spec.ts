// Spec for https://github.com/virtUOS/wolke/issues/187, part 1: the desktop
// grid card is opaque, the mobile list row is not.
//
// Every version of the watermark design assumed the cards sit on an opaque
// surface, so that on a desktop the mark shows only in the canvas gaps; ours
// were a border plus content with no fill, so the mark's strokes ran straight
// through the cards and their text — the reason issue #181 had to pull the
// dark opacity down to 0.035. The split is the point: the mobile reference
// shows the mark crossing the transparent list rows, and that stays.
//
// This is a change to the core tile, not to the watermark: it applies in
// every deployment, including those with no mark configured, which is why
// this spec runs against the shipped configuration (no mark) rather than
// enabling one.

import type { Locator, Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** Seeded in dev/seed.sql. */
const SERVICE = 'MyShare'

function tileOf(page: Page, isMobile: boolean): Locator {
  const container = isMobile ? '.tile-list-item' : '.tile-grid'
  return page.locator(container, { has: page.getByRole('link', { name: new RegExp(SERVICE) }) }).first()
}

/** The alpha of a computed colour, for the two forms Chromium hands back:
 *  rgb(a)(…) and color(srgb r g b [/ a]). */
function alphaOf(css: string): number {
  let m = /^rgba?\([\d.]+,\s*[\d.]+,\s*[\d.]+(?:,\s*([\d.]+))?\)$/.exec(css)
  if (m) return m[1] === undefined ? 1 : Number(m[1])
  m = /^color\(srgb\s+[\d.]+\s+[\d.]+\s+[\d.]+(?:\s*\/\s*([\d.]+))?\)$/.exec(css)
  if (m) return m[1] === undefined ? 1 : Number(m[1])
  throw new Error(`unparsed colour: ${css}`)
}

const background = (locator: Locator) => locator.evaluate((n) => getComputedStyle(n).backgroundColor)

test('the grid card is opaque and the list row is transparent', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page)
  const tile = tileOf(page, isMobile)
  await expect(tile).toBeVisible()

  const bg = await background(tile)
  if (isMobile) {
    expect(alphaOf(bg), `the list row must stay transparent, got ${bg}`).toBe(0)
  } else {
    expect(alphaOf(bg), `the grid card must be opaque, got ${bg}`).toBe(1)
    // The fill is the surface token — a card, not the canvas painted again.
    const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim())
    const asRgb = await page.evaluate((hex) => {
      const probe = document.createElement('div')
      probe.style.color = hex
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }, surface)
    expect(bg).toBe(asRgb)
  }
})

test('the card stays opaque under the pointer', async ({ page }, testInfo) => {
  testInfo.skip(testInfo.project.use.isMobile === true, 'hover is a pointer-layout concern')
  await gotoApp(page)
  const tile = tileOf(page, false)
  await expect(tile).toBeVisible()
  // The hover wash used to be `accent 7% over transparent` with !important —
  // which would have made an opaque card see-through again exactly while the
  // user looks at it.
  await tile.hover()
  const bg = await background(tile)
  expect(alphaOf(bg), `the hovered card must stay opaque, got ${bg}`).toBe(1)
})

// The dark theme uses the same tokens by a different value; the split is a
// property of the tile, not of the palette.
test.describe('in the dark theme', () => {
  test.use({ colorScheme: 'dark' })

  test('the split holds', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page)
    const tile = tileOf(page, isMobile)
    await expect(tile).toBeVisible()
    const bg = await background(tile)
    expect(alphaOf(bg)).toBe(isMobile ? 0 : 1)
  })

  // Issue #187, follow-up decision: the dark canvas is plain --bg, not the
  // accent-tinted mix it used to be. With the tint the opaque card (--surface)
  // sat *darker* than the canvas — a recess where the reference shows a raised,
  // lighter card on a (22,22,24) canvas. Light keeps its 5% tint on purpose:
  // there a slightly darker card reads as a delineated surface. Asserted on the
  // rendered colours, not the constants, so a theme wired up wrongly fails.
  test('the canvas is plain --bg and the opaque card sits lighter than it', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.use.isMobile === true, 'the opaque card is the desktop layout')
    await gotoApp(page)
    const tile = tileOf(page, false)
    await expect(tile).toBeVisible()

    const { canvas, bgToken, card } = await page.evaluate(() => {
      const parse = (css: string): number[] => {
        let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(css)
        if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
        m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(css)
        if (m) return [m[1], m[2], m[3]].map((c) => Number(c) * 255)
        throw new Error(`unparsed colour: ${css}`)
      }
      const asRgb = (value: string) => {
        const probe = document.createElement('div')
        probe.style.color = value
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).color
        probe.remove()
        return parse(out)
      }
      const lum = (c: number[]) => {
        const f = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
      }
      const canvasCss = getComputedStyle(document.querySelector('.app-canvas')!).backgroundColor
      const cardCss = getComputedStyle(document.querySelector('.tile-grid')!).backgroundColor
      const canvas = parse(canvasCss)
      const card = parse(cardCss)
      return {
        canvas: { rgb: canvas.map(Math.round), lum: lum(canvas) },
        bgToken: asRgb(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()).map(Math.round),
        card: { rgb: card.map(Math.round), lum: lum(card) },
      }
    })
    expect(canvas.rgb, `the dark canvas must be plain --bg, got ${canvas.rgb}`).toEqual(bgToken)
    expect(card.lum, `the card ${card.rgb} must be lighter than the canvas ${canvas.rgb}`).toBeGreaterThan(canvas.lum)
  })
})
