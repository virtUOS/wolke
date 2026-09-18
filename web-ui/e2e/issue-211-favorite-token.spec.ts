// Issue #211: the favourites star has its own `--favorite` token, decoupled
// from `--accent`.
//
// The unit suite (src/__tests__/favorite-token.test.tsx) pins the wiring: which
// variable each consumer names. It cannot pin the *result*, because the two
// consumers most likely to drift back together — the tile hover wash and the
// light canvas tint — are `color-mix()` values that jsdom does not compute, and
// one of them lives in the stylesheet rather than in a style attribute.
//
// So the acceptance criterion is checked here instead, in a real engine and
// against computed colour: move one token, read all of them back. Both
// directions matter, and the second is the one that carries the issue —
//
//   1. moving `--favorite` moves the star and nothing else;
//   2. moving `--accent` moves the wash and *not* the star.
//
// Before this issue, (2) was impossible: one token painted both.
//
// The segmented control's active pill is the one accent consumer left to the
// unit test. It only exists inside an opened menu, and driving one open here
// would buy a second assertion about the same token at the cost of a much more
// fragile test; its pill background is an inline style, which jsdom reads
// perfectly well.

import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** Two colours nothing in the palette uses, so a stray match cannot be luck. */
const NEW_FAVORITE = 'rgb(29, 78, 216)'
const NEW_ACCENT = 'rgb(16, 185, 129)'

interface Paint {
  star: string
  canvas: string
  tileHoverBg: string
}

/**
 * Reads back every colour under test in one pass.
 *
 * The hover wash is sampled by hovering the first tile — the wash is a
 * pseudo-class rule, so nothing else would ever evaluate it. Only the
 * background is read: the grid card's hover also washes its border, but the
 * layout here follows the session's persisted view mode, and forcing that to
 * grid would write a pref the whole matrix shares (see favorites-order.spec.ts
 * on why these specs never write). The border rule names the same variable on
 * the same line; the unit suite holds it.
 */
async function paint(page: import('@playwright/test').Page): Promise<Paint> {
  const star = page.locator('button[aria-pressed="true"][aria-label*="Favoriten"]').first()
  await expect(star).toBeVisible()

  const tile = page.locator('.tile-grid, .tile-list-item').first()
  await tile.hover()

  return {
    star: await star.evaluate((el) => getComputedStyle(el).color),
    canvas: await page
      .locator('.app-canvas')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    tileHoverBg: await tile.evaluate((el) => getComputedStyle(el).backgroundColor),
  }
}

/** Overrides a brand token the way GET /api/branding's injected sheet does. */
async function setToken(page: import('@playwright/test').Page, name: string, value: string) {
  await page.evaluate(([n, v]) => document.documentElement.style.setProperty(n, v), [name, value])
}

test('retinting --favorite moves the star and leaves the accent wash alone', async ({ page }) => {
  await gotoApp(page)
  const before = await paint(page)

  await setToken(page, '--favorite', NEW_FAVORITE)
  const after = await paint(page)

  expect(after.star).toBe(NEW_FAVORITE)
  // …and nothing else. The acceptance criterion, in computed colour.
  expect(after.canvas).toBe(before.canvas)
  expect(after.tileHoverBg).toBe(before.tileHoverBg)
})

test('retinting --accent moves the wash and leaves the star alone', async ({ page }) => {
  await gotoApp(page)
  const before = await paint(page)

  await setToken(page, '--accent', NEW_ACCENT)
  const after = await paint(page)

  // The star is out of the accent's blast radius — the whole point of #211.
  expect(after.star).toBe(before.star)
  // The wash still answers to it. A mix, not the raw value: assert it moved,
  // not what it became — the percentage is the hover rule's business.
  expect(after.tileHoverBg).not.toBe(before.tileHoverBg)
})

test('the default is a no-op: star and accent start from the same colour', async ({ page }) => {
  await gotoApp(page)
  const resolved = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement)
    return { accent: s.getPropertyValue('--accent').trim(), favorite: s.getPropertyValue('--favorite').trim() }
  })
  // Served by GET /api/branding, not read off the stylesheet: this is the whole
  // chain — config.go → payload → applyBrandingTokens → the live variable.
  expect(resolved.favorite).not.toBe('')
  expect(resolved.favorite).toBe(resolved.accent)
})
