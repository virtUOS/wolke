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
})
