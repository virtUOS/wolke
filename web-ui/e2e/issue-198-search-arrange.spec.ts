// Issue #198 — search vs. the Anordnen edit mode, and search state across the
// 768px breakpoint (docs/specs/search-view-state.md).
//
// What this file adds over the unit suite is the thing jsdom cannot give: a
// real *crossing* of the breakpoint. The matrix already runs every flow at both
// layouts, but six fixed viewports only ever prove the two static ends — and
// the defect here is entirely in the transition, in state that one layout sets
// and the other inherits.
//
// So each project starts at its own matrix viewport, resizes to the far side of
// 768px, asserts the destination, and comes back. Coming back is not tidiness:
// `fixtures.ts` runs the viewport assertions after every test against whatever
// size the page ended in, with the *project's* isMobile — so a test that ended
// on the other side would check the wrong contract at the wrong width.

import type { Page } from '@playwright/test'
import { MOBILE_BREAKPOINT_PX } from '../src/lib/breakpoints'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { openSearch, searchPill } from './helpers/search'
import { expect, test } from './fixtures'

/** The far side of the breakpoint from this project — a real matrix size, not
 *  an invented one: a phone crosses to the 1280×720 desktop, everything at or
 *  above the breakpoint crosses to the 390×844 phone. */
const DESKTOP_STOP = { width: 1280, height: 720 }
const PHONE_STOP = { width: 390, height: 844 }

/**
 * Resizes, and waits for the engine to have *laid the page out* at the new
 * width — not just accepted the new viewport.
 *
 * `setViewportSize` resolves on the metrics override; the style recalc that
 * re-evaluates the `md:` media queries the control sizes hang off happens on
 * the next layout. Reading `clientWidth` forces that layout and is polled until
 * it agrees, which is the cheapest honest barrier. Without it the assertions
 * that follow — and the auto viewport guard, which measures whatever state the
 * test ends in — can read the *previous* layout: the guard has caught the app
 * bar still wearing its desktop 26px avatar at 390px and failed it against the
 * phone's 44px touch floor.
 */
async function resizeTo(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForFunction((w) => document.documentElement.clientWidth === w, size.width)
}

const tabRow = (page: Page) => page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })
const resultsHeading = (page: Page) =>
  page.getByRole('main').getByRole('heading', { level: 2, name: /Suchergebnisse|Search results/ })

/** Merges the patch onto the real /api/me and answers with it, writing nothing
 *  — favorites-order.spec.ts's reason verbatim: six projects share one user's
 *  prefs row, so a real PATCH of `favorites_order` leaks into the other five. */
async function stubPrefs(page: Page) {
  await page.route('**/api/me/prefs', async (route) => {
    const patch = route.request().postDataJSON() as Record<string, unknown>
    const current = await (await page.request.get('/api/me')).json()
    await route.fulfill({ json: { ...current, ...patch } })
  })
}

/** Serves the user's real favorites and swallows the order writes, so the
 *  arrange mode can be entered without six workers racing on one list. */
async function stubFavorites(page: Page) {
  const body = (await (await page.request.get('/api/favorites')).json()) as {
    services: { id: string; name: string }[]
  }
  await page.route('**/api/favorites', (route) => route.fulfill({ json: body }))
  await page.route('**/api/favorites/order', (route) => route.fulfill({ status: 204, body: '' }))
  expect(body.services.length, 'the seeded user has favorites to arrange').toBeGreaterThan(1)
}

/**
 * Opens Favoriten, switches to the manual order and enters the edit mode.
 *
 * Deliberately entered from `?tab=dienste`, so the history entry behind the
 * edit mode is a *different* tab. Favoriten is the launcher's default view, so
 * a plain `/` would put Favoriten behind Favoriten and Back would land right
 * back in the mode — which is correct (spec §2: the flag and the view agree),
 * and therefore not a test of anything.
 */
async function startArranging(page: Page) {
  await gotoApp(page, '/?tab=dienste')
  await tabRow(page).getByRole('button', { name: /^Favoriten|^Favorites/ }).click()
  await page.getByRole('button', { name: /Reihenfolge:/ }).click()
  const panel = page.getByRole('dialog', { name: 'Reihenfolge' })
  await panel.locator('label:has(input[value="manual"])').click()
  await panel.getByRole('button', { name: 'Anordnen' }).click()
  await expect(page.getByRole('button', { name: 'Fertig' })).toBeVisible()
  // The edit mode owns the view: the tab row steps aside for its bar.
  await expect(tabRow(page)).toHaveCount(0)
}

test('starting a search cancels the arrange mode, and clearing it does not restore it', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  await stubFavorites(page)
  await startArranging(page)
  await expectViewportHealthy(page, { isMobile, label: 'arrange mode, before the search' })

  // The entry point stays reachable during arrange — deliberately (spec §2).
  // What it must not do is leave both views on screen at once.
  const search = await openSearch(page)
  await search.fill('Netzspeicher')
  await expect(resultsHeading(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fertig' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toHaveCount(0)
  await expectViewportHealthy(page, { isMobile, label: 'search results, arrange cancelled' })

  // Cancelled, not suppressed: standing down lands on the ordinary favorites
  // list with its tab row, never back inside the edit mode.
  await search.fill('')
  await expect(tabRow(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fertig' })).toHaveCount(0)
  await expect(resultsHeading(page)).toHaveCount(0)
})

test('arrange mode does not follow the user onto another tab', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  await stubFavorites(page)
  await startArranging(page)

  // The tab row is hidden, so Back is the way out a user has — and the view it
  // returns to must have its own chrome, not a favorites edit mode's absence
  // of it (spec §1, the half the issue did not report).
  await page.goBack()
  await expect(page).toHaveURL(/tab=dienste/)
  await expect(tabRow(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fertig' })).toHaveCount(0)
  await expectViewportHealthy(page, { isMobile, label: 'tab row back after leaving arrange' })
})

test('a query survives a crossing of the breakpoint, in a field the destination renders', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  const start = testInfo.project.use.viewport!
  const other = isMobile ? DESKTOP_STOP : PHONE_STOP
  expect(
    start.width < MOBILE_BREAKPOINT_PX,
    'the project is on the side of the breakpoint its isMobile claims',
  ).toBe(isMobile)

  await gotoApp(page)
  const search = await openSearch(page)
  await search.fill('Netzspeicher')
  await expect(resultsHeading(page)).toBeVisible()

  await resizeTo(page, other)

  // The typed text crosses — losing it on a rotate is the worse failure — and
  // it lands somewhere the reader can see it and clear it. On a phone that
  // means the overlay is up on arrival, however the query got there.
  const carried = page.getByRole('searchbox')
  await expect(carried).toBeVisible()
  await expect(carried).toHaveValue('Netzspeicher')
  await expect(resultsHeading(page)).toBeVisible()
  if (!isMobile) {
    await expect(page.getByRole('button', { name: /Suche schließen|Close search/ })).toBeVisible()
  }
  await expectViewportHealthy(page, {
    isMobile: !isMobile,
    label: `query carried across to ${other.width}px`,
  })

  // …and back, where it is still the same query in this layout's own field.
  await resizeTo(page, start)
  await expect(page.getByRole('searchbox')).toHaveValue('Netzspeicher')
  await expect(resultsHeading(page)).toBeVisible()
})

test('the phone overlay never arrives from a layout that has no overlay', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  const start = testInfo.project.use.viewport!
  await gotoApp(page)

  if (isMobile) {
    // Reveal the overlay, then leave the layout that renders it. Coming back
    // must not find it still standing: nothing about it outlives the crossing.
    await openSearch(page)
    await expect(searchPill(page)).toHaveAttribute('aria-expanded', 'true')
    await resizeTo(page, DESKTOP_STOP)
    await expect(page.getByRole('banner').getByRole('searchbox')).toBeVisible()
    await expect(page.getByRole('button', { name: /Suche schließen|Close search/ })).toHaveCount(0)
    await expectViewportHealthy(page, { isMobile: false, label: 'desktop bar after the overlay was up' })
  } else {
    // ⌘K on a desktop is a plain focus of the field already in the bar. It must
    // not set the phone's reveal flag — that is what popped the full-bar
    // overlay open, aria-expanded="true", on the next narrow resize.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('banner').getByRole('searchbox')).toBeFocused()
  }

  // Whichever direction it came from, the phone bar shows its collapsed pill
  // and no field, because no query is standing behind it.
  await resizeTo(page, PHONE_STOP)
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(searchPill(page)).toHaveAttribute('aria-expanded', 'false')
  await expectViewportHealthy(page, { isMobile: true, label: 'collapsed phone pill after a crossing' })

  await resizeTo(page, start)
  await expect(tabRow(page)).toBeVisible()
})
