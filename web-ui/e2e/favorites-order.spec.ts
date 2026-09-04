// Issue #125: the favorites order selector and the "Anordnen" edit mode, at
// every resolution in the matrix (docs/specs/responsive-viewport-testing.md).
// The edit mode is three 44px targets plus a service name per row, which is the
// exact shape that overflows a 324px phone — hence the full matrix, and hence
// the explicit touch-target measurements below.
//
// Writes are stubbed, for the reason account-menu.spec.ts stubs prefs: the mock
// IdP maps every viewport project onto the same test user, so six workers share
// one session's write-rate bucket *and* one row of server-side prefs. A real
// PATCH here would leak this spec's order mode into the other five projects
// (and into the specs that assert the default favorites view), and six workers
// reordering the same favorites would race. Fulfilling the writes client-side
// keeps each project's UI honest and the server untouched.

import type { Locator, Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** Merges the patch onto the real /api/me and answers with it, writing nothing. */
async function stubPrefs(page: Page) {
  await page.route('**/api/me/prefs', async (route) => {
    const patch = route.request().postDataJSON() as Record<string, unknown>
    const current = await (await page.request.get('/api/me')).json()
    await route.fulfill({ json: { ...current, ...patch } })
  })
}

interface FavoritesStub {
  /** The payloads the UI sent, in order — the write contract under test. */
  sent: string[][]
  /** The names the stub currently serves, i.e. the persisted order. */
  order: () => string[]
}

/**
 * Stands in for the favorites half of the API: it serves the user's real
 * favorites (read once through the session), applies each order write to that
 * list, and records what was sent.
 *
 * A write stub alone is not enough here. The order mutation invalidates the
 * favorites query, so the refetch decides what the user ends up looking at — a
 * stub that accepted the write but kept answering the old order would revert
 * every move a moment after it happened, and the assertions would be racing the
 * refetch rather than testing the feature. Applying the write is what makes the
 * loop the UI actually runs (optimistic move → PUT → refetch) observable.
 */
async function stubFavorites(page: Page): Promise<FavoritesStub> {
  const res = await page.request.get('/api/favorites')
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { services: { id: string; name: string }[] }
  let services = body.services
  const sent: string[][] = []

  await page.route('**/api/favorites', (route) => route.fulfill({ json: { services } }))
  // Registered after the read, so it wins for the /order sub-path.
  await page.route('**/api/favorites/order', async (route) => {
    const { service_ids: ids } = route.request().postDataJSON() as { service_ids: string[] }
    sent.push(ids)
    const byID = new Map(services.map((s) => [s.id, s]))
    // Exactly what the server does: a permutation, applied as a whole list.
    expect([...byID.keys()].sort()).toEqual([...ids].sort())
    services = ids.map((id) => byID.get(id)!)
    await route.fulfill({ status: 204, body: '' })
  })

  return { sent, order: () => services.map((s) => s.name) }
}

async function expectTouchTarget(locator: Locator, isMobile: boolean, what: string): Promise<void> {
  if (!isMobile) return
  const box = await locator.boundingBox()
  expect(box, `${what} has no box`).not.toBeNull()
  expect(box!.height, `${what} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
  expect(box!.width, `${what} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
}

/** The arrange rows' visible labels, without their position prefix. */
async function arrangedNames(page: Page): Promise<string[]> {
  const rows = page.getByRole('listitem')
  return (await rows.allInnerTexts()).map((t) => t.replace(/^\d+\.\s*/, '').split('\n')[0].trim())
}

async function openFavorites(page: Page) {
  await gotoApp(page)
  await page.getByRole('button', { name: 'Favoriten', exact: true }).first().click()
  await expect(page.getByRole('group', { name: 'Reihenfolge' })).toBeVisible()
}

test('the order selector offers the three modes and stays inside the viewport', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  await stubFavorites(page)
  await openFavorites(page)

  const group = page.getByRole('group', { name: 'Reihenfolge' })
  for (const label of ['Häufig genutzt', 'Alphabetisch', 'Eigene Reihenfolge']) {
    const option = group.getByRole('button', { name: label, exact: true })
    await expect(option).toBeVisible()
    await expectTouchTarget(option, isMobile, `order option ${label}`)
  }
  // 'usage' is the default the server ships; nothing has been written yet.
  await expect(group.getByRole('button', { name: 'Häufig genutzt' })).toHaveAttribute('aria-pressed', 'true')
  await expectViewportHealthy(page, { isMobile, label: 'favorites order selector' })

  // Alphabetical is a computed mode: no edit mode is offered for it.
  await group.getByRole('button', { name: 'Alphabetisch' }).click()
  await expect(group.getByRole('button', { name: 'Alphabetisch' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Anordnen' })).toHaveCount(0)
})

test('the first switch to manual starts from the usage order', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  const favorites = await stubFavorites(page)
  await openFavorites(page)

  // What the user effectively has, before they touch anything: nothing has been
  // reordered yet, so the stub is still serving the server's usage order — which
  // is precisely the sequence the manual mode has to start from.
  const usageOrder = favorites.order()
  expect(usageOrder.length).toBeGreaterThan(1)

  const group = page.getByRole('group', { name: 'Reihenfolge' })
  await group.getByRole('button', { name: 'Eigene Reihenfolge' }).click()
  await expect(group.getByRole('button', { name: 'Eigene Reihenfolge' })).toHaveAttribute('aria-pressed', 'true')

  // Entering the edit mode shows the same sequence the user just had — the
  // seeded-from-usage promise. (The server-side seeding of manual_sort itself is
  // asserted against a real database in internal/server's integration test;
  // here the writes are stubbed, so what this pins is that the UI does not
  // reshuffle the list on the way into the mode.)
  await page.getByRole('button', { name: 'Anordnen' }).click()
  await expect.poll(() => arrangedNames(page)).toEqual(usageOrder)
  await expectViewportHealthy(page, { isMobile, label: 'favorites arrange mode' })
})

test('reordering with the buttons is keyboard-operable and sends the whole list', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  const favorites = await stubFavorites(page)
  await openFavorites(page)

  await page.getByRole('group', { name: 'Reihenfolge' }).getByRole('button', { name: 'Eigene Reihenfolge' }).click()
  await page.getByRole('button', { name: 'Anordnen' }).click()

  const before = await arrangedNames(page)
  expect(before.length).toBeGreaterThan(1)
  const first = before[0]
  const second = before[1]

  // Every row action is a real touch target at phone widths — three of them
  // next to a long German service name is what issue #101 was about.
  for (const action of ['Nach oben', 'Nach unten', 'An den Anfang']) {
    await expectTouchTarget(
      page.getByRole('button', { name: `${action} – ${second}` }),
      isMobile,
      `${action} on row 2`,
    )
  }
  // The moves that would leave the list are disabled rather than absent, so the
  // row keeps a stable shape as it travels.
  await expect(page.getByRole('button', { name: `Nach oben – ${first}` })).toBeDisabled()
  await expect(page.getByRole('button', { name: `An den Anfang – ${first}` })).toBeDisabled()

  // Keyboard only: focus the button and press it. Focus must land on the moved
  // row's button again, so the next press continues the same move.
  const down = page.getByRole('button', { name: `Nach unten – ${first}` })
  await down.focus()
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => (await arrangedNames(page)).slice(0, 2))
    .toEqual([second, first])
  await expect(page.getByRole('button', { name: `Nach unten – ${first}` })).toBeFocused()

  // The write is the whole ordered list, not a move instruction.
  expect(favorites.sent.length).toBeGreaterThan(0)
  expect(favorites.sent[favorites.sent.length - 1].length).toBe(before.length)
  // And it is the arrangement the server now holds, not just what is on screen.
  expect(favorites.order().slice(0, 2)).toEqual([second, first])

  // "An den Anfang" walks a row back to the top in one press, and focus follows
  // it onto an action that still works (▲ and "an den Anfang" are now disabled).
  await page.getByRole('button', { name: `An den Anfang – ${first}` }).click()
  await expect.poll(async () => (await arrangedNames(page))[0]).toBe(first)
  expect(favorites.order()[0]).toBe(first)
  await expect(page.getByRole('button', { name: `Nach unten – ${first}` })).toBeFocused()

  await expectViewportHealthy(page, { isMobile, label: 'favorites arrange mode, after reordering' })

  // Leaving the edit mode returns the normal favorites view.
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(page.getByRole('button', { name: 'Anordnen' })).toBeVisible()
})
