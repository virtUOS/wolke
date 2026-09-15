// Viewport + a11y spec for https://github.com/virtUOS/wolke/issues/171
// "Launcher: global search in the app bar with results grouped by Favoriten /
// Alle Dienste".
//
// The issue's two settled decisions are what shapes this file: search stays
// server-side, and search stays a *view*. So there is no panel here to test —
// what is measured instead is the entry point at every matrix resolution, and
// the fact that everything downstream of it still behaves:
//
//   1. the app bar with the search entry point AND a long product name at 324
//      — #170 had to fix a real overflow in that row, and #171 adds a control
//      to it;
//   2. searching from each entry point (the desktop field, the phone pill);
//   3. launching a result and toggling a favorite from the results;
//   4. ⌘K / "/" — including the two suppressions that keep the layering bug of
//      PR #169 from coming back.
//
// A long product name is the default here rather than a special case: "wolke"
// fits anything, and the row this touches is exactly the one that broke.

import type { Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { closeSearch, openSearch, searchPill } from './helpers/search'
import { expect, test } from './fixtures'

/** A product name as long as a real institution's (issue #170). */
async function stubLongProductName(page: Page): Promise<void> {
  await page.route('**/api/branding', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ json: { ...body, product_name: 'Serviceportal Universität' } })
  })
}

const tabRow = (page: Page) => page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })

test('the entry point sits in the app bar, and the bar still fits a long name', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubLongProductName(page)
  await gotoApp(page)

  const bar = page.getByRole('banner')
  // Whatever the entry point is at this width, it is up here and not in the
  // content column — that is the whole change.
  await expect(page.getByRole('main').getByRole('searchbox')).toHaveCount(0)

  if (isMobile) {
    const pill = searchPill(page)
    await expect(pill).toBeVisible()
    await expect(pill).toHaveAttribute('aria-expanded', 'false')
    const box = await pill.boundingBox()
    expect(box!.height, 'the search pill meets the touch floor').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  } else {
    await expect(bar.getByRole('searchbox')).toBeVisible()
  }

  await expectViewportHealthy(page, { isMobile, label: 'app bar with the search entry point' })

  // …and revealed, at a phone width, it must still not push the document wide.
  const search = await openSearch(page)
  const fieldBox = await search.boundingBox()
  expect(fieldBox!.height, 'the search field meets the touch floor').toBeGreaterThanOrEqual(
    isMobile ? MIN_TOUCH_TARGET : 0,
  )
  await expectViewportHealthy(page, { isMobile, label: 'search field open' })
})

test('searching from the entry point lands in the results view', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubLongProductName(page)
  await gotoApp(page)

  const search = await openSearch(page)
  await search.fill('Netzspeicher')

  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: /MyShare/ }).first()).toBeVisible()
  // The destination is unchanged: the content area, headed "Suchergebnisse",
  // with neither tab claiming the view (issue #170 + #171).
  await expect(main.getByRole('heading', { level: 2, name: /Suchergebnisse|Search results/ })).toBeVisible()
  await expect(tabRow(page).locator('button[aria-current="page"]')).toHaveCount(0)
  // And it never reaches the URL.
  await expect(page).not.toHaveURL(/Netzspeicher/)

  await expectViewportHealthy(page, { isMobile, label: 'search results from the app bar' })
})

/**
 * Stands in for the favorites half of the API for one page: it serves the
 * user's real favorites and applies each add/remove to that list.
 *
 * Stubbed rather than written for real because the whole matrix shares one
 * logged-in session (helpers/session.ts) and runs its six projects in
 * parallel — a real star toggle here is a write six tests would race each
 * other on, and the tab count they all assert is derived from it.
 */
async function stubFavorites(page: Page): Promise<void> {
  const body = (await (await page.request.get('/api/favorites')).json()) as {
    services: { id: string; name: string }[]
  }
  let services = body.services

  await page.route('**/api/favorites', (route) => route.fulfill({ json: { services } }))
  await page.route('**/api/favorites/items', async (route) => {
    const { service_id: id } = route.request().postDataJSON() as { service_id: string }
    if (route.request().method() === 'DELETE') {
      services = services.filter((s) => s.id !== id)
    } else if (!services.some((s) => s.id === id)) {
      // The name is only ever read back by the Favoriten tab's own list; the
      // count is what this spec asserts, so the id stands in for it.
      services = [...services, { id, name: id }]
    }
    await route.fulfill({ status: 204, body: '' })
  })
}

test('a favorite can be starred from the results, and the tab count follows', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubFavorites(page)
  await gotoApp(page, '/?tab=dienste')

  const favTab = tabRow(page).getByRole('button', { name: /^Favoriten|^Favorites/ })
  await expect(favTab).toHaveText(/^\D+ \d+$/)
  const before = Number((await favTab.textContent())!.match(/(\d+)$/)![1])

  const search = await openSearch(page)
  await search.fill('Netzspeicher')
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: /MyShare/ }).first()).toBeVisible()

  // MyShare is a seeded favorite, so its star is the "remove" one: un-starring
  // from inside the results has to take the tab count with it.
  const star = main.getByRole('button', { name: /MyShare aus Favoriten entfernen|Remove MyShare/ })
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  await star.click()
  await expect(favTab).toHaveText(new RegExp(`${before - 1}$`))
  await expect(main.getByRole('button', { name: /MyShare zu Favoriten|Add MyShare/ })).toBeVisible()
  await expectViewportHealthy(page, { isMobile, label: 'star toggled inside the results' })
})

test('the results say which set each hit belongs to', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubFavorites(page)
  await gotoApp(page, '/?tab=dienste')

  const search = await openSearch(page)
  // A query wide enough to cross the line: seeded favorites and non-favorites.
  await search.fill('e')
  const main = page.getByRole('main')
  await expect(main.getByRole('link').first()).toBeVisible()

  const heads = main.getByRole('heading', { level: 3 })
  await expect(heads).toHaveText([/Favoriten · \d+/, /Alle Dienste · \d+/])
  // Favorites first, and each heading's count is the number of hits under it.
  // Count the tiles themselves (one root per hit in either layout), not links
  // by accessible name: a tile carries several links (launch, guide, …) whose
  // names all share words, so a name regex counts some hits twice and breaks
  // again whenever a control is added inside a tile (#185 did exactly that).
  for (const head of await heads.all()) {
    const claimed = Number((await head.textContent())!.match(/(\d+)$/)![1])
    const shown = await head.locator('xpath=..').locator('.tile-grid, .tile-list-item').count()
    expect(shown, `${await head.textContent()} lists what it counts`).toBe(claimed)
  }

  await expectViewportHealthy(page, { isMobile, label: 'grouped search results' })
})

test('launching a result by a plain click clears the search and stands the field down', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page, '/?tab=dienste')

  const search = await openSearch(page)
  await search.fill('Netzspeicher')
  const result = page.getByRole('main').getByRole('link', { name: /MyShare/ }).first()
  await expect(result).toBeVisible()

  const [popup] = await Promise.all([page.context().waitForEvent('page'), result.click()])
  await popup.close()

  // Issue #26/#27: the tool opened in a new tab, so the query it was found
  // with is stale. On a phone the revealed field goes away with it.
  if (isMobile) {
    await expect(page.getByRole('searchbox')).toHaveCount(0)
    await expect(searchPill(page)).toHaveAttribute('aria-expanded', 'false')
  } else {
    await expect(search).toHaveValue('')
  }
  await expect(page.getByRole('main').getByRole('link', { name: /BigBlueButton/ }).first()).toBeVisible()
  await expectViewportHealthy(page, { isMobile, label: 'back on the catalogue after a launch' })
})

test('closing the phone field returns to the tab it was opened from', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.isMobile !== true, 'the reveal is the phone entry point')
  await gotoApp(page, '/?tab=dienste')

  const search = await openSearch(page)
  await search.fill('Netzspeicher')
  await expect(page.getByRole('main').getByRole('link', { name: /MyShare/ }).first()).toBeVisible()

  await closeSearch(page)
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('link', { name: /BigBlueButton/ }).first()).toBeVisible()
  await expect(page).toHaveURL(/tab=dienste/)
})

test('⌘K and "/" reach the field — and defer to whatever is layered above', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page)

  const field = page.getByRole('searchbox')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(field).toBeFocused()
  // A visible ring, not merely focus (docs/03 §8).
  const ring = await field.evaluate((el) => {
    const s = getComputedStyle(el)
    return { width: s.outlineWidth, shadow: s.boxShadow }
  })
  expect(ring.shadow !== 'none' || parseFloat(ring.width) > 0, 'the focused field shows a ring').toBe(true)

  // "/" inside the field is a slash, not a second shortcut.
  await field.fill('')
  await page.keyboard.press('/')
  await expect(field).toHaveValue('/')
  await field.fill('')

  await field.blur()
  if (isMobile) await closeSearch(page)
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox')).toBeFocused()
  await expect(page.getByRole('searchbox')).toHaveValue('')

  // Layering: the account menu is a role="dialog" that owns focus and Escape
  // while it is up. A shortcut that ignores that is the bug PR #169 fixed.
  await page.getByRole('searchbox').blur()
  if (isMobile) await closeSearch(page)
  await page.getByRole('button', { name: /Konto-Menü öffnen|Open account menu/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('searchbox')).toHaveCount(isMobile ? 0 : 1)
  if (!isMobile) await expect(page.getByRole('searchbox')).not.toBeFocused()
  await page.keyboard.press('Escape')
  await expectViewportHealthy(page, { isMobile, label: 'after the shortcut deferred to the menu' })
})
