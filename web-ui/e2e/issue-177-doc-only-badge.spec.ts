// Regression spec for https://github.com/virtUOS/wolke/issues/177
// "Tiles: drop the 'Dokumentation' status badge from documentation-only
// services" — a service with no launch URL used to carry a neutral
// "Dokumentation" badge in the same slot as Beta and Wartung, which read as a
// status the user was meant to act on. It isn't one: "this entry links to a
// help page rather than an app" is a property of the link, and the user finds
// that out by following it.
//
// `doc_only` itself stays — it suppresses the secondary "Doku" chip on a tile
// whose main link already *is* the documentation — so both halves are asserted
// here: no status badge, and still exactly one link.
//
// Runs at every viewport in the matrix: the grid card and the phone list row
// render the name row differently, and the fixture's auto viewport guard
// covers the final state on each project. The long-name case is the one the
// badge used to crowd, so it is stubbed rather than hoped for.

import type { Locator, Page } from '@playwright/test'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** The seeded documentation-only entry (dev/seed.sql): doc_url, no service_url. */
const DOC_ONLY_NAME = 'WLAN an der UOS'

/** A worst-case real name for the row the badge used to share. */
const LONG_NAME_DE = 'WLAN-Zugang für Hochschulangehörige an der UOS'

/** The tile container for the layout this project renders. */
function tileOf(page: Page, name: string, isMobile: boolean): Locator {
  const container = isMobile ? '.tile-list-item' : '.tile-grid'
  return page.locator(container, { has: page.getByRole('link', { name: new RegExp(name) }) }).first()
}

/** Renames the doc-only service in /api/catalog to `name`. */
async function stubDocOnlyName(page: Page, name: string) {
  await page.route('**/api/catalog', async (route) => {
    const catalog = await (await page.request.get('/api/catalog')).json()
    for (const service of catalog.services) {
      if (service.name === DOC_ONLY_NAME) service.name = name
    }
    await route.fulfill({ json: catalog })
  })
}

test.describe('issue #177 — a doc-only tile carries no status badge', () => {
  test('the documentation-only entry shows no badge and stays a single link', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true

    await gotoApp(page, '/?tab=dienste')
    const tile = tileOf(page, DOC_ONLY_NAME, isMobile)
    await expect(tile).toBeVisible()

    // The badge is gone from the visible text — in either locale's wording, and
    // the short "Doku" chip with it (the main link is already the docs).
    await expect(tile.getByText('Dokumentation', { exact: true })).toHaveCount(0)
    await expect(tile.getByText('Documentation', { exact: true })).toHaveCount(0)
    await expect(tile.getByText('Doku', { exact: true })).toHaveCount(0)

    // One link: the full-coverage launch overlay, pointing at the doc URL.
    const links = tile.locator('a')
    await expect(links).toHaveCount(1)
    await expect(links.first()).toHaveAttribute('href', /docs\.example\.edu/)

    // The accessible name keeps the distinction the badge used to make
    // visible — the decision recorded on the issue.
    await expect(links.first()).toHaveAccessibleName(new RegExp(`${DOC_ONLY_NAME}.*Dokumentation`))
  })

  test('a long doc-only name stays inside its tile', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true

    await stubDocOnlyName(page, LONG_NAME_DE)
    await gotoApp(page, '/?tab=dienste')

    const tile = tileOf(page, 'WLAN-Zugang', isMobile)
    await expect(tile).toBeVisible()

    const name = tile.locator('span.hyphenate-compound').first()
    await expect(name).toBeVisible()

    const [tileBox, nameBox] = await Promise.all([tile.boundingBox(), name.boundingBox()])
    expect(tileBox, 'tile has a box').not.toBeNull()
    expect(nameBox, 'name has a box').not.toBeNull()
    // One pixel of slack for sub-pixel layout; anything more is the overflow
    // this spec exists to catch.
    expect(nameBox!.x + nameBox!.width, 'name right edge vs. tile right edge').toBeLessThanOrEqual(
      tileBox!.x + tileBox!.width + 1,
    )
    expect(nameBox!.x, 'name left edge vs. tile left edge').toBeGreaterThanOrEqual(tileBox!.x - 1)
  })
})
