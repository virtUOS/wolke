// Spec for https://github.com/virtUOS/wolke/issues/185
// "Service tile: replace the footer 'Doku' button with an 'Anleitung' help icon
// beside the star" — the secondary documentation control is an icon-only link
// (styled like the IconButton) in the tile's action cluster, directly left of
// the favourite star, in both layouts. It opens the guide in a new tab and
// never launches the tile.
//
// Runs at every viewport in the matrix. The touch-target assertion at the phone
// sizes is the reason the handoff's 32/36px boxes were overruled for the star's
// own 44px floor (issue #185, settled decision 2): the fixture's auto guard
// covers the whole page, and the control is named here so a regression reads as
// "the guide link shrank". From `md:` up it collapses to the star's box.

import type { Locator, Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** Seeded with both a service_url and a doc_url (dev/seed.sql). */
const SERVICE = 'MyShare'
const GUIDE_URL = 'https://docs.example.edu/myshare'
/** Where a launch or guide click is recorded (src/lib/api.ts, recordClick). */
const CLICKS_PATH = '/api/events/click'
/** The seeded documentation-only entry: doc_url, no service_url. */
const DOC_ONLY = 'WLAN an der UOS'

/** The full accessible name — the new-tab warning is part of the contract. */
const GUIDE_NAME = 'Anleitung öffnen (öffnet in neuem Tab)'

/** The compact desktop box the link shares with the star (`md:h-7 md:w-7`). */
const DESKTOP_BOX = 28

/** The old footer pill's height: 16px text-xs line + 2×4px padding + 2×1px border. */
const FOOTER_MIN_HEIGHT = 26

function tileOf(page: Page, name: string, isMobile: boolean): Locator {
  const container = isMobile ? '.tile-list-item' : '.tile-grid'
  return page.locator(container, { has: page.getByRole('link', { name: new RegExp(name) }) }).first()
}

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, 'element has no box').not.toBeNull()
  return b!
}

/**
 * The seeded guide URL does not resolve from the test machine, so a real popup
 * would land on Chromium's error page. Serve a stub at context level (the
 * popup is a new page in the same context) so its URL is the guide's own.
 */
async function stubGuidePage(page: Page) {
  await page.context().route(GUIDE_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>guide</title>' }),
  )
}

/** Drops `doc_url` from every service in /api/catalog, so no tile has a guide link. */
async function stubNoGuides(page: Page) {
  await page.route('**/api/catalog', async (route) => {
    const catalog = await (await page.request.get('/api/catalog')).json()
    for (const service of catalog.services) {
      if (service.service_url) service.doc_url = null
    }
    await route.fulfill({ json: catalog })
  })
}

test.describe('issue #185 — the guide link beside the star', () => {
  test('is a link left of the star, sized like it, with the Anleitung copy', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page, '/?tab=dienste')

    const tile = tileOf(page, SERVICE, isMobile)
    await expect(tile).toBeVisible()

    const help = tile.getByRole('link', { name: GUIDE_NAME })
    const star = tile.getByRole('button', { name: /Favoriten/ })
    await expect(help).toBeVisible()
    await expect(star).toBeVisible()
    await expect(help).toHaveAttribute('title', 'Anleitung')

    // A real link with an href (the review's guard against a <button> that
    // opens the URL by script), new tab, no opener.
    await expect(help).toHaveJSProperty('tagName', 'A')
    await expect(help).toHaveAttribute('href', GUIDE_URL)
    await expect(help).toHaveAttribute('target', '_blank')
    await expect(help).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(tile.getByRole('button', { name: GUIDE_NAME })).toHaveCount(0)

    // No "Doku" survives, as text or as a name; the tile has exactly two
    // links — the launch overlay and the guide.
    await expect(tile.getByText(/Doku/)).toHaveCount(0)
    await expect(tile.getByRole('link', { name: /Doku/ })).toHaveCount(0)
    await expect(tile.locator('a')).toHaveCount(2)

    // Left of the star, on the same row, immediately adjacent.
    const [helpBox, starBox] = await Promise.all([box(help), box(star)])
    expect(helpBox.x + helpBox.width, 'guide right edge vs. star left edge').toBeLessThanOrEqual(starBox.x + 1)
    expect(starBox.x - (helpBox.x + helpBox.width), 'gap to the star').toBeLessThanOrEqual(8)
    expect(Math.abs(helpBox.y + helpBox.height / 2 - (starBox.y + starBox.height / 2)), 'vertically centred with the star').toBeLessThanOrEqual(1)

    if (isMobile) {
      // Settled decision 2: the phone floor, not the mockup's 36px.
      expect(helpBox.width, 'guide link width').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(helpBox.height, 'guide link height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(helpBox.width, 'same box as the star').toBe(starBox.width)
      expect(helpBox.height, 'same box as the star').toBe(starBox.height)
    } else {
      // …and the pointer layout keeps the star's compact density.
      expect(helpBox.width, 'guide link width').toBeLessThanOrEqual(DESKTOP_BOX)
      expect(helpBox.height, 'guide link height').toBeLessThanOrEqual(DESKTOP_BOX)
      expect(helpBox.width, 'same box as the star').toBe(starBox.width)
    }
  })

  test('opens the guide in a new tab and does not launch the tile', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await stubGuidePage(page)
    await gotoApp(page, '/?tab=dienste')
    const tile = tileOf(page, SERVICE, isMobile)
    const help = tile.getByRole('link', { name: GUIDE_NAME })
    await expect(help).toBeVisible()

    const clicks = page.waitForRequest((r) => r.url().includes(CLICKS_PATH) && r.method() === 'POST')
    const before = page.url()
    // The same popup pattern search.spec.ts uses for the launch link.
    const [popup] = await Promise.all([page.context().waitForEvent('page'), help.click()])
    expect(popup.url(), 'the new tab is the guide').toBe(GUIDE_URL)
    await popup.close()

    // Settled decision 4: the metrics target keeps its value.
    const body = (await clicks).postDataJSON() as { target?: string }
    expect(body.target, 'click target label').toBe('documentation')

    expect(page.url(), 'the launcher itself did not navigate').toBe(before)
  })

  test('is in the tab order after the tile link and before the star, and takes Enter', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await stubGuidePage(page)
    await gotoApp(page, '/?tab=dienste')
    const tile = tileOf(page, SERVICE, isMobile)
    const link = tile.getByRole('link', { name: new RegExp(SERVICE) })
    const help = tile.getByRole('link', { name: GUIDE_NAME })
    const star = tile.getByRole('button', { name: /Favoriten/ })
    await expect(help).toBeVisible()

    await link.focus()
    await page.keyboard.press('Tab')
    await expect(help).toBeFocused()
    // A visible focus ring: the shared IconButton ring, not the browser default.
    const ring = await help.evaluate((el) => getComputedStyle(el).boxShadow)
    expect(ring, 'focus-visible ring').not.toBe('none')
    await page.keyboard.press('Tab')
    await expect(star).toBeFocused()

    // Enter on the link opens the guide and reaches neither the star nor the
    // tile link underneath.
    const pressed = await star.getAttribute('aria-pressed')
    const before = page.url()
    await help.focus()
    const [popup] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('Enter')])
    expect(popup.url(), 'Enter opens the guide').toBe(GUIDE_URL)
    await popup.close()
    expect(page.url(), 'the launcher itself did not navigate').toBe(before)
    await expect(star).toHaveAttribute('aria-pressed', pressed!)
  })

  test('is absent from a documentation-only tile', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoApp(page, '/?tab=dienste')
    const tile = tileOf(page, DOC_ONLY, isMobile)
    await expect(tile).toBeVisible()
    // Settled decision 1: the tile's own link already opens the documentation.
    await expect(tile.getByRole('link', { name: GUIDE_NAME })).toHaveCount(0)
    await expect(tile.getByRole('button', { name: /Favoriten/ })).toBeVisible()
  })

  test('the grid footer is label-only and the row height does not depend on the link', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'the footer is grid-layout only (>= 768px)')

    // First pass: the seeded catalog, where some cards have a guide link.
    await gotoApp(page, '/?tab=dienste')
    await expect(page.locator('.tile-grid').first()).toBeVisible()
    // Web-font metrics decide how the description wraps, so both passes must
    // measure after the fonts have settled or the heights are not comparable.
    const measure = async () => {
      await page.evaluate(() => document.fonts.ready)
      return page.$$eval('.tile-grid', (cards) =>
        cards.map((card) => {
          const name = card.querySelector('span.hyphenate-compound')?.textContent ?? ''
          // The category label is the only text-xs span that also hyphenates;
          // a Beta badge is text-xs too, but sits in the name row.
          const label = card.querySelector('span.text-xs.hyphenate-compound')
          const footer = label?.parentElement
          return {
            name,
            height: card.getBoundingClientRect().height,
            footerHeight: footer?.getBoundingClientRect().height ?? 0,
            footerControls: footer?.querySelectorAll('a, button').length ?? -1,
            footerText: footer?.textContent?.trim() ?? '',
            labelText: label?.textContent?.trim() ?? '',
            hasGuide: card.querySelector('a[title="Anleitung"]') !== null,
          }
        }),
      )
    }
    const withGuides = await measure()
    expect(withGuides.some((c) => c.hasGuide), 'some cards render a guide link').toBe(true)
    for (const c of withGuides) {
      expect(c.footerControls, `${c.name}: controls in the footer`).toBe(0)
      expect(c.footerText, `${c.name}: footer text is the category only`).toBe(c.labelText)
      expect(c.footerHeight, `${c.name}: footer height`).toBeGreaterThanOrEqual(FOOTER_MIN_HEIGHT)
    }

    // Second pass: no card has a guide link. Every card must keep its height
    // — the control moved out of the footer, so the footer's own min-height is
    // what holds the grid's rows where they were.
    await stubNoGuides(page)
    await gotoApp(page, '/?tab=dienste')
    await expect(page.locator('.tile-grid').first()).toBeVisible()
    const withoutGuides = await measure()
    expect(withoutGuides.some((c) => c.hasGuide), 'the stub removed every guide link').toBe(false)
    // Compare by name, not by index: parallel workers record clicks for the
    // same user, so a "frequently used" section can appear between the two
    // passes and shift the card order. A card that had a guide link in the
    // first pass must be the same height without it in the second.
    const after = new Map(withoutGuides.map((c) => [c.name, c.height]))
    const compared = withGuides.filter((c) => c.hasGuide && after.has(c.name))
    expect(compared.length, 'cards with a guide link that are present in both passes').toBeGreaterThan(0)
    for (const before of compared) {
      expect(after.get(before.name), `${before.name}: card height with vs. without the guide link`).toBe(before.height)
    }
  })
})
