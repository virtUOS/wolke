// Issue #125: the favorites sort menu and the "Anordnen" edit mode, at every
// resolution in the matrix (docs/specs/responsive-viewport-testing.md).
//
// The order now lives behind a compact trigger beside the "Favoriten" heading:
// a popover from the md: breakpoint up, a bottom sheet below it. Both open
// states are asserted healthy at every resolution — a panel that opens is a
// layout state like any other, and the sheet in particular is new geometry at
// the narrowest widths. The edit mode is three 44px targets plus a service name
// per row, which is the exact shape that overflows a 324px phone — hence the
// full matrix, and hence the explicit touch-target measurements below.
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

/** The sort trigger. Its accessible name carries the order it currently shows. */
function sortTrigger(page: Page, active: string): Locator {
  return page.getByRole('button', { name: `Reihenfolge: ${active}` })
}

/**
 * Opens the sort menu and returns its panel. The popover and the sheet are the
 * same dialog to a user (and to a screen reader): one named "Reihenfolge" that
 * holds the radio group — so every assertion below reads identically at both
 * layouts, which is the point of the shared contract.
 */
async function openSortMenu(page: Page, active: string): Promise<Locator> {
  await sortTrigger(page, active).click()
  const panel = page.getByRole('dialog', { name: 'Reihenfolge' })
  await expect(panel).toBeVisible()
  return panel
}

/** The three orders as (radio value, visible label). */
const ORDER_OPTIONS = [
  ['usage', 'Häufig genutzt'],
  ['alpha', 'Alphabetisch'],
  ['manual', 'Eigene Reihenfolge'],
] as const

/**
 * A radio's row. The radio itself is sr-only (the platform control inside its
 * own label, the ChoiceChip idiom), so the <label> is both the hit area and
 * what a user actually clicks — never the inner text span, which is only as
 * tall as the text.
 */
function orderRow(panel: Locator, value: string): Locator {
  return panel.locator(`label:has(input[value="${value}"])`)
}

async function pickOrder(panel: Locator, value: string, label: string) {
  await orderRow(panel, value).click()
  await expect(panel.getByRole('radio', { name: label })).toBeChecked()
}

async function openFavorites(page: Page) {
  await gotoApp(page)
  await page.getByRole('button', { name: 'Favoriten', exact: true }).first().click()
  // 'usage' is the default the server ships; nothing has been written yet.
  await expect(sortTrigger(page, 'Häufig genutzt')).toBeVisible()
}

test('the sort menu offers the three modes and stays inside the viewport', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  await stubFavorites(page)
  await openFavorites(page)

  // The trigger is a real touch target at phone widths and shows the active
  // order as its visible label (the design's icon-only variant was rejected).
  const trigger = sortTrigger(page, 'Häufig genutzt')
  await expect(trigger).toHaveText(/Häufig genutzt/)
  await expectTouchTarget(trigger, isMobile, 'sort trigger')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expectViewportHealthy(page, { isMobile, label: 'favorites heading with the sort trigger' })

  const panel = await openSortMenu(page, 'Häufig genutzt')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const group = panel.getByRole('radiogroup', { name: 'Reihenfolge' })
  for (const [value, label] of ORDER_OPTIONS) {
    await expect(group.getByRole('radio', { name: label })).toBeAttached()
    // The sr-only radio's hit area is its label, so that is what gets measured.
    await expectTouchTarget(orderRow(panel, value), isMobile, `order option ${label}`)
  }
  await expect(group.getByRole('radio', { name: 'Häufig genutzt' })).toBeChecked()
  // The open panel is a layout state: sheet at phone widths, popover above.
  await expectViewportHealthy(page, { isMobile, label: 'favorites sort menu, open' })

  // Alphabetical is a computed mode: no edit mode is offered for it, and the
  // pick applies immediately with the panel still open.
  await pickOrder(panel, 'alpha', 'Alphabetisch')
  await expect(panel.getByRole('button', { name: 'Anordnen' })).toHaveCount(0)
  await expect(sortTrigger(page, 'Alphabetisch')).toBeVisible()
})

test('the sort menu is keyboard-operable and closes with a named control', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  await stubFavorites(page)
  await openFavorites(page)

  const panel = await openSortMenu(page, 'Häufig genutzt')
  // Arrow keys move *and* select: real radios, not buttons pretending to be.
  await panel.getByRole('radio', { name: 'Häufig genutzt' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByRole('radio', { name: 'Alphabetisch' })).toBeChecked()

  if (isMobile) {
    // A phone has no Escape key and a scrim tap has no accessible name, so the
    // sheet must carry a focusable, named way out (the drag handle).
    const close = panel.getByRole('button', { name: 'Schließen' })
    await expectTouchTarget(close, isMobile, 'sheet close control')
    await close.click()
  } else {
    await page.keyboard.press('Escape')
    // Focus returns to the trigger — the panel was a focus-managed disclosure.
    await expect(sortTrigger(page, 'Alphabetisch')).toBeFocused()
  }
  await expect(page.getByRole('dialog', { name: 'Reihenfolge' })).toHaveCount(0)
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

  const panel = await openSortMenu(page, 'Häufig genutzt')
  await pickOrder(panel, 'manual', 'Eigene Reihenfolge')
  // "Anordnen" appears only once a manual order is what is being shown.
  const arrange = panel.getByRole('button', { name: 'Anordnen' })
  await expect(arrange).toBeVisible()
  await expectTouchTarget(arrange, isMobile, 'Anordnen')
  await expectViewportHealthy(page, { isMobile, label: 'favorites sort menu, manual order' })

  // Entering the edit mode shows the same sequence the user just had — the
  // seeded-from-usage promise. (The server-side seeding of manual_sort itself is
  // asserted against a real database in internal/server's integration test;
  // here the writes are stubbed, so what this pins is that the UI does not
  // reshuffle the list on the way into the mode.)
  await arrange.click()
  await expect.poll(() => arrangedNames(page)).toEqual(usageOrder)
  await expectViewportHealthy(page, { isMobile, label: 'favorites arrange mode' })
})

test('reordering with the buttons is keyboard-operable and sends the whole list', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  const favorites = await stubFavorites(page)
  await openFavorites(page)

  const panel = await openSortMenu(page, 'Häufig genutzt')
  await pickOrder(panel, 'manual', 'Eigene Reihenfolge')
  await panel.getByRole('button', { name: 'Anordnen' }).click()

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

  // Leaving the edit mode through "Fertig" keeps the arrangement and returns
  // the normal favorites view, with the trigger showing the manual order.
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(sortTrigger(page, 'Eigene Reihenfolge')).toBeVisible()
  expect(favorites.order()[0]).toBe(first)
})

// "Abbrechen" is not a discarded draft — every move already wrote through — so
// it restores the arrangement the screen was entered with, via the same write.
test('Abbrechen restores the order the edit mode was entered with', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await stubPrefs(page)
  const favorites = await stubFavorites(page)
  await openFavorites(page)

  const panel = await openSortMenu(page, 'Häufig genutzt')
  await pickOrder(panel, 'manual', 'Eigene Reihenfolge')
  await panel.getByRole('button', { name: 'Anordnen' }).click()

  const before = await arrangedNames(page)
  expect(before.length).toBeGreaterThan(1)

  await page.getByRole('button', { name: `Nach unten – ${before[0]}` }).click()
  await expect.poll(async () => (await arrangedNames(page)).slice(0, 2)).toEqual([before[1], before[0]])

  const cancel = page.getByRole('button', { name: 'Abbrechen' })
  await expectTouchTarget(cancel, isMobile, 'Abbrechen')
  await cancel.click()

  // Back on the favorites view, holding exactly what it held before — on the
  // server, not just on screen.
  await expect(sortTrigger(page, 'Eigene Reihenfolge')).toBeVisible()
  await expect.poll(() => favorites.order()).toEqual(before)
})
