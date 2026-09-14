// Viewport + a11y spec for https://github.com/virtUOS/wolke/issues/170
// "Launcher: move the Favoriten/Alle Dienste switch into an underline tab row
// above the list".
//
// The issue names the risks to measure rather than assume, and this is where
// they are measured, at every matrix resolution:
//   1. the tab row at 324×756 — "Favoriten n" + "Alle Dienste n" + the sort
//      control on one row, with no horizontal document scroll;
//   2. the app bar, now a single row, with a *long* realistic product name —
//      not "wolke", which fits anything;
//   3. the combination that started the whole thing: an announcement present,
//      the tab row, and the list, at 324 and 360.
// Plus the states the row has: both tabs, a search (neither tab current), and
// the arrange edit mode, in which the row steps aside.
//
// Announcements are seeded via page.route, not the admin API: the admin write
// endpoints share one rate-limit bucket keyed by session token and the whole
// matrix shares one logged-in session (the #115 lesson, see
// admin-announcements.spec.ts).

import type { Locator, Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** A two-line German announcement of the kind that pushes the list down. */
const ANNOUNCEMENT = {
  id: 'e2e-170',
  title: { de: 'Wartung Identitätsmanagement', en: 'Maintenance: identity management' },
  body: {
    de: 'HISinOne ist am Samstag, 13.09., von 6–9 Uhr nicht erreichbar. Die Anmeldung an Stud.IP bleibt davon unberührt.',
    en: 'HISinOne is unavailable on Saturday 13.09. between 6am and 9am.',
  },
  severity: 'info',
  audience: 'all',
  dismissible: true,
  created_at: '2026-09-11T09:00:00Z',
}

async function stubAnnouncement(page: Page): Promise<void> {
  await page.route('**/api/announcements', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: { announcements: [ANNOUNCEMENT] } })
  })
}

/** A product name as long as a real institution's, for the app-bar check. */
async function stubLongProductName(page: Page): Promise<void> {
  await page.route('**/api/branding', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ json: { ...body, product_name: 'Serviceportal Universität' } })
  })
}

function tabRow(page: Page): Locator {
  return page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })
}

const favTab = (page: Page) => tabRow(page).getByRole('button', { name: /^Favoriten|^Favorites/ })
const allTab = (page: Page) => tabRow(page).getByRole('button', { name: /^Alle Dienste|^All services/ })

/** Both tabs are named with a trailing count once the queries have answered —
 *  separated by a real space, so the accessible name reads "Favoriten 4". */
async function expectCounted(tab: Locator): Promise<void> {
  await expect(tab).toHaveText(/^\D+ \d+$/)
}

/** The tab the row reports as current, if any. */
function currentTab(page: Page): Locator {
  return tabRow(page).locator('button[aria-current="page"]')
}

async function expectTouchTarget(locator: Locator, isMobile: boolean, what: string): Promise<void> {
  if (!isMobile) return
  const box = await locator.boundingBox()
  expect(box, `${what} has no box`).not.toBeNull()
  expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
}

test('the tab row sits above the list, carries both counts, and switches the view', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page)

  const fav = favTab(page)
  const all = allTab(page)
  await expect(fav).toHaveAttribute('aria-current', 'page')
  await expectCounted(fav)
  await expectCounted(all)
  await expectTouchTarget(fav, isMobile, 'Favoriten tab')
  await expectTouchTarget(all, isMobile, 'Alle Dienste tab')

  // It is navigation, not an ARIA tablist (issue #170, settled decision 1):
  // switching pushes a history entry, and no arrow-key tab model is promised.
  await expect(page.locator('[role="tablist"], [role="tab"], [role="tabpanel"]')).toHaveCount(0)

  // …and it is below the greeting, not up in the app bar.
  const bar = page.getByRole('banner')
  await expect(bar.getByRole('button', { name: /^Favoriten|^Favorites/ })).toHaveCount(0)
  const h1 = await page.getByRole('heading', { level: 1 }).boundingBox()
  const row = await tabRow(page).boundingBox()
  expect(row!.y, 'the tab row sits below the greeting').toBeGreaterThan(h1!.y)

  await expectViewportHealthy(page, { isMobile, label: 'favorites tab' })

  await all.click()
  await expect(page).toHaveURL(/tab=dienste/)
  await expect(all).toHaveAttribute('aria-current', 'page')
  await expect(fav).not.toHaveAttribute('aria-current', 'page')
  await expectViewportHealthy(page, { isMobile, label: 'alle dienste tab' })

  // Back is a real history step (issue #29) — the switch is navigation.
  await page.goBack()
  await expect(fav).toHaveAttribute('aria-current', 'page')
})

// The finding that started the issue: the switch was furthest from the list it
// controls exactly when an announcement pushed the list down.
test('an announcement, the tab row and the list coexist without overflow', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubAnnouncement(page)
  await gotoApp(page)

  await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toBeVisible()
  const row = await tabRow(page).boundingBox()
  expect(row, 'the tab row is still on screen with an announcement present').not.toBeNull()
  await expectCounted(favTab(page))
  await expectViewportHealthy(page, { isMobile, label: 'announcement + tab row + list' })

  await allTab(page).click()
  await expectViewportHealthy(page, { isMobile, label: 'announcement + tab row + all services' })
})

// The app bar lost its second row on phones, so it now has to fit the wordmark
// and the actions on one line — with a real institution's product name.
test('the one-row app bar fits a long product name', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubLongProductName(page)
  await gotoApp(page)

  const bar = page.getByRole('banner')
  await expect(bar.getByText('Serviceportal Universität')).toBeVisible()
  const box = await bar.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.width, 'the app bar stays inside the viewport').toBeLessThanOrEqual(viewport.width + 1)
  await expectViewportHealthy(page, { isMobile, label: 'one-row app bar, long product name' })
})

// Settled decision 3: the sort control is favorites-only, and its slot must not
// move the tabs when it comes and goes.
test('the sort control rides on the row for favorites only, without moving the tabs', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page)

  const sort = tabRow(page).getByRole('button', { name: /Reihenfolge:|Order:/ })
  await expect(sort).toBeVisible()
  await expectTouchTarget(sort, isMobile, 'sort trigger')
  const before = await favTab(page).boundingBox()

  await allTab(page).click()
  await expect(sort).toHaveCount(0)
  const after = await favTab(page).boundingBox()
  expect(Math.abs(after!.y - before!.y), 'the tabs do not shift when the sort control goes').toBeLessThanOrEqual(1)
  expect(Math.abs(after!.x - before!.x), 'the tabs do not shift horizontally either').toBeLessThanOrEqual(1)
  await expectViewportHealthy(page, { isMobile, label: 'tab row without the sort slot filled' })
})

// A search is a global view of its own, so neither tab is current while one is
// active — and the in-content search field stays where it is until #171.
test('a search leaves neither tab current and keeps the in-content field', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page)

  const search = page.getByRole('searchbox')
  await expect(search).toBeVisible()
  await search.fill('Stud')
  await expect(page.getByRole('main').getByRole('link', { name: /Stud\.IP/ }).first()).toBeVisible()

  await expect(currentTab(page)).toHaveCount(0)
  await expectViewportHealthy(page, { isMobile, label: 'tab row during a search' })
})

test('the tab row is focus-visible and keyboard-operable', async ({ page }) => {
  await gotoApp(page)
  const all = allTab(page)

  await all.focus()
  await expect(all).toBeFocused()
  // A visible ring, not just a focused element (docs/03 §4 — brand red).
  const ring = await all.evaluate((el) => {
    const s = getComputedStyle(el)
    return { width: s.outlineWidth, shadow: s.boxShadow }
  })
  expect(ring.shadow !== 'none' || parseFloat(ring.width) > 0, 'the focused tab shows a ring').toBe(true)

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/tab=dienste/)
  await expect(all).toHaveAttribute('aria-current', 'page')
})
