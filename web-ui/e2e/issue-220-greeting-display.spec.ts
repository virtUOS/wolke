// Viewport + contrast spec for https://github.com/virtUOS/wolke/issues/220
// "Greeting: heavier display treatment (500) and an optional accented full stop".
//
// Device testing answered the weight #213 deliberately left open — 300 read
// flimsy — so the display treatment becomes 500 at −0.015em on both surfaces
// that carry it, and the launcher greeting's trailing full stop is set in the
// brand primary.
//
// What needs a real engine rather than jsdom:
//
//   1. the *resolved* colour of the accent. The stop is declared
//      `var(--primary)`, and that variable arrives from /api/branding at
//      runtime — only a browser that applied the payload can say what colour
//      was actually painted, which is also what the contrast numbers below are
//      computed from.
//   2. the contrast itself, in both themes, against the canvas the greeting
//      actually sits on (light tints --bg with 5% accent; dark does not).
//   3. the watermark anchor. line-height is unchanged, so the mark should not
//      move — #195's geometry is worth pinning rather than assuming.
//
// The unit suites own the rest: the declared treatment
// (src/__tests__/greeting-typography.test.tsx), what the accent wraps in both
// locales (greeting-accent.test.tsx), and the payload default
// (internal/config, internal/server).

import type { Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const greeting = (page: Page) => page.getByRole('heading', { level: 1 })
/** The accented stop: the one element the greeting ever nests. */
const accentStop = (page: Page) => greeting(page).locator('span')

/**
 * The accent's contrast against the canvas it is painted on, as rendered.
 *
 * Both colours are read back from the engine rather than from the tokens: the
 * palette arrives at runtime from /api/branding, and the light canvas is a
 * color-mix the stylesheet never states as a literal. WCAG 2.1 relative
 * luminance, computed in the page (no eval — the app ships a strict CSP).
 */
async function accentContrast(page: Page): Promise<{ ratio: number; fg: string; bg: string }> {
  return page.evaluate(() => {
    // Two shapes reach us: `rgb(r, g, b)` with 0–255 channels, and the
    // `color(srgb r g b)` Chromium hands back for a resolved color-mix — the
    // light canvas — with 0–1 channels. Reading the second as the first would
    // make the tinted white read as near-black, and the test would fail on a
    // unit rather than on a colour.
    const parse = (c: string) => {
      const n = c.match(/[\d.]+/g)!.slice(0, 3).map(Number)
      return c.trim().startsWith('color(') ? n.map((v) => v * 255) : n
    }
    const lum = (c: string) => {
      const [r, g, b] = parse(c).map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const fg = getComputedStyle(document.querySelector('h1 span')!).color
    // The canvas, not the body: the launcher tints --bg with 5% accent in
    // light (DashboardShell), and that tint is what the glyph sits on.
    const bg = getComputedStyle(document.querySelector('.app-canvas')!).backgroundColor
    const [a, b] = [lum(fg), lum(bg)]
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fg, bg }
  })
}

/** Serves a /api/branding with `greeting_accent: false`, the way a deployment
 *  opting out would, and reloads into it. */
async function withAccentOff(page: Page, body: () => Promise<void>) {
  await page.route('**/api/branding', async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({ response, json: { ...payload, greeting_accent: false } })
  })
  try {
    await gotoApp(page)
    await body()
  } finally {
    await page.unroute('**/api/branding')
    await gotoApp(page)
  }
}

test.describe('the display treatment', () => {
  test('the greeting is drawn at 500 with −0.015em', async ({ page }, testInfo) => {
    await gotoApp(page)
    const style = await greeting(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return { weight: s.fontWeight, tracking: s.letterSpacing, size: s.fontSize, leading: s.lineHeight }
    })
    expect(style.weight).toBe('500')
    // −0.015em of the element's own size, which the engine reports in px.
    const size = Number.parseFloat(style.size)
    expect(Number.parseFloat(style.tracking)).toBeCloseTo(-0.015 * size, 1)
    // The two tiers the launcher has, unchanged by this issue: `isMobile` is
    // the shell's single 768px switch, so the tablet project takes the large
    // size. A third tier would need its own breakpoint — see the PR.
    expect(size).toBe(testInfo.project.use.isMobile === true ? 27 : 36)
    // line-height is what the watermark anchor depends on; it does not move.
    expect(Number.parseFloat(style.leading)).toBeCloseTo(1.05 * size, 1)
  })

  test('the admin heading carries the same treatment', async ({ page }) => {
    await page.goto('/?admin=1')
    const heading = page.getByRole('heading', { level: 1, name: /Administration/i })
    await expect(heading).toBeVisible()
    const style = await heading.evaluate((el) => {
      const s = getComputedStyle(el)
      return { weight: s.fontWeight, tracking: s.letterSpacing, size: s.fontSize, spans: el.querySelectorAll('*').length }
    })
    expect(style.weight).toBe('500')
    expect(Number.parseFloat(style.tracking)).toBeCloseTo(-0.015 * Number.parseFloat(style.size), 1)
    // No accented stop here: the admin title is a label, not a sentence, so
    // there is no punctuation to accent — confirmed rather than assumed.
    expect(style.spans).toBe(0)
  })
})

test.describe('the accented full stop', () => {
  test('is painted in the brand primary, and wraps the punctuation only', async ({ page }) => {
    await gotoApp(page)
    await expect(accentStop(page)).toHaveCount(1)
    expect(await accentStop(page).textContent()).toBe('.')
    const { stop, root } = await page.evaluate(() => ({
      stop: getComputedStyle(document.querySelector('h1 span')!).color,
      // What --primary resolved to after /api/branding was applied.
      root: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    }))
    // Same colour, reached through the token: a deployer's own primary is what
    // gets drawn, never a literal of ours.
    const asRGB = (hex: string) => {
      const n = Number.parseInt(hex.replace('#', ''), 16)
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
    }
    expect(stop).toBe(asRGB(root))
  })

  test('greeting_accent: false drops the colour and keeps the stop', async ({ page }) => {
    await withAccentOff(page, async () => {
      await expect(accentStop(page)).toHaveCount(0)
      // The line is still a sentence.
      expect((await greeting(page).textContent())!.trim()).toMatch(/\.$/)
    })
  })
})

// The measurement the issue asks for, kept as an assertion so it cannot rot.
//
// The stop is part of a text node, so it is text, and the threshold is the one
// WCAG 1.4.3 sets for the size it is drawn at. The greeting is 36px desktop /
// 27px phone at weight 500 — both above the 24px large-text boundary — so the
// governing minimum is 3:1, not 4.5:1.
//
// Measured with the bundled skin (see the PR body for the numbers):
//   light  #A6093D on the tinted canvas  7.5:1 — passes 4.5:1 outright
//   dark   #C2355C on #161618            3.4:1 — passes 3:1, below 4.5:1
//
// The dark pairing is the closer of the two and is reported rather than
// patched: --primary is a brand token, and quietly lightening it here would
// re-colour every other surface that uses it.
test.describe('contrast of the accented stop', () => {
  const LARGE_TEXT_MIN = 3

  test('light', async ({ page }) => {
    await gotoApp(page)
    const { ratio, fg, bg } = await accentContrast(page)
    expect(ratio, `accent ${fg} on canvas ${bg}`).toBeGreaterThanOrEqual(LARGE_TEXT_MIN)
    // Light clears the stricter bar too, and should keep doing so.
    expect(ratio, `accent ${fg} on canvas ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' })

    test('meets the large-text minimum', async ({ page }) => {
      await gotoApp(page)
      const { ratio, fg, bg } = await accentContrast(page)
      expect(ratio, `accent ${fg} on canvas ${bg}`).toBeGreaterThanOrEqual(LARGE_TEXT_MIN)
      // Pinned as a fact, not an aspiration: if a skin change pushed this over
      // 4.5 the comment above is stale and should be updated with it.
      expect(ratio, `accent ${fg} on canvas ${bg}`).toBeLessThan(4.5)
    })
  })
})

// #195's geometry: the mark's top is the greeting's top. The treatment changes
// weight and tracking, neither of which moves a block's top edge — but the
// anchor is a measurement published by the greeting itself, so "should not
// move" is worth an assertion.
test.describe('the watermark anchor is unmoved', () => {
  const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 47">
  <path fill="#000" d="M17.5 1 34 12v23L17.5 46 1 35V12Z"/>
</svg>`
  const MARK_URL = '/branding/watermark.svg'

  test('the mark still starts at the greeting', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.use.isMobile === true, 'the phone mark is bottom-anchored (#181)')
    await page.route('**/api/branding', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ json: { ...(await res.json()), watermark: MARK_URL } })
    })
    await page.route(`**${MARK_URL}`, (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: MARK_SVG }),
    )
    await gotoApp(page)
    const markTop = (await page.locator('.app-watermark').boundingBox())!.y
    const greetingTop = (await greeting(page).boundingBox())!.y
    expect(markTop, "the mark's top is the greeting's top").toBeCloseTo(greetingTop, 0)
  })
})
