// Regression spec for https://github.com/virtUOS/wolke/issues/99
// "Bigger elements in mobile mode" — users found the phone UI cramped, the
// service list rows most of all. The decision was better defaults rather than a
// user-facing size setting, so the guarantee is a *floor* on the phone layout
// and *no change* to the pointer layout.
//
// Both halves are asserted here: the phone rows and their controls are
// comfortably large, and from `md:` up the shared primitives keep the compact
// density they were designed with (so the pass can't quietly inflate desktop).

import type { Page } from '@playwright/test'
import { MIN_TOUCH_TARGET } from './helpers/rules'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** The row height the phone list is designed around: 44px icon chip + 2×14px. */
const MIN_ROW_HEIGHT = 70

/** The row's own controls, by their real accessible names (src/lib/i18n.ts). */
const ROW_CONTROLS = [
  { what: 'documentation link', name: 'Doku (öffnet in neuem Tab)' },
  { what: 'favourite star', name: /zu Favoriten hinzufügen$|aus Favoriten entfernen$/ },
]

async function heights(page: Page, selector: string): Promise<number[]> {
  return page.$$eval(selector, (els) => els.map((el) => el.getBoundingClientRect().height))
}

test.describe('issue #99 — the phone layout is comfortably sized', () => {
  test('every service row is a comfortable height with 44px controls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile !== true, 'the list row is the phone layout')

    await gotoApp(page, '/?tab=dienste')
    await expect(page.locator('.tile-list-item').first()).toBeVisible()

    const rows = await heights(page, '.tile-list-item')
    expect(rows.length, 'service rows').toBeGreaterThan(3)
    for (const [i, h] of rows.entries()) {
      expect(h, `service row ${i} height`).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT)
    }

    // The two controls inside a row. The fixture's touch-target check covers
    // the whole page; this names them, so a regression reads as "the star
    // shrank" rather than a generic violation.
    //
    // `:not(.tile-focus-link)` excludes the row's full-coverage launch overlay:
    // it is a link too, and for a doc-only entry its accessible name is
    // "… – Dokumentation öffnen", which a loose /Dokumentation/ matcher hit
    // instead of the docs chip. Every seeded service has a doc_url, so both
    // controls must be there — a missing one is a failure, not a skip.
    const row = page.locator('.tile-list-item').first()
    for (const { what, name } of ROW_CONTROLS) {
      const control = row
        .locator('a:not(.tile-focus-link), button')
        .and(page.getByRole('link', { name }).or(page.getByRole('button', { name })))
      await expect(control, `${what} is in the row`).toHaveCount(1)
      await expect(control, `${what} is visible`).toBeVisible()
      const box = (await control.boundingBox())!
      expect(box.height, `${what} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(box.width, `${what} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
  })

  test('the search field and the section tabs meet the touch floor', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile !== true, 'touch targets are a phone concern')

    await gotoApp(page, '/?tab=dienste')
    const search = page.getByRole('searchbox')
    expect((await search.boundingBox())!.height, 'search field height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)

    const nav = page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/i })
    for (const label of ['Favoriten', 'Dienste']) {
      const box = await nav.getByRole('button', { name: label }).boundingBox()
      expect(box!.height, `${label} tab height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
  })

  // The other half of the decision: the pointer layout is untouched. These
  // upper bounds are the designed densities (docs/03 §4) — a future change that
  // pushes phone sizing up into the desktop breakpoint fails here.
  test('the pointer layout keeps its compact density', async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.isMobile === true, 'this is the >= md layout')

    await page.goto('/?admin=1')
    await expect(page.getByRole('heading', { level: 1, name: /Administration/i })).toBeVisible()

    // Section tab (PillButton): compact, not the 44px phone pill.
    const tab = page.getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i }).getByRole('button').first()
    expect((await tab.boundingBox())!.height, 'admin tab height').toBeLessThanOrEqual(40)

    // Button size="sm" — the list/toolbar action.
    const newService = page.getByRole('button', { name: 'Neuer Dienst' })
    expect((await newService.boundingBox())!.height, 'sm button height').toBeLessThanOrEqual(40)

    // Select and Input, on the announcement form.
    await page
      .getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i })
      .getByRole('button', { name: 'Ankündigungen', exact: true })
      .click()
    await page.getByRole('button', { name: 'Ankündigung anlegen' }).click()
    expect((await page.getByLabel('Zielgruppe').boundingBox())!.height, 'select height').toBeLessThanOrEqual(40)
    expect(
      (await page.getByLabel(/Titel \(de\)/).boundingBox())!.height,
      'input height',
    ).toBeLessThanOrEqual(40)

    // The keyword chip is the tightest spot the phone floor reaches into: its
    // remove control is a 44px target on a phone, so md: has to hand back both
    // the 16px box *and* the chip's own right inset, or the chip reads as
    // lopsided on a desktop that was supposed to be untouched.
    await page
      .getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i })
      .getByRole('button', { name: 'Dienste', exact: true })
      .click()
    await page.getByRole('button', { name: 'Neuer Dienst' }).click()
    const keywords = page.getByLabel('Suchbegriffe (optional)')
    await keywords.fill('fernzugriff')
    await keywords.press('Enter')
    const chip = page.getByRole('listitem').filter({ hasText: 'fernzugriff' })
    const removeButton = chip.getByRole('button', { name: /fernzugriff/ })
    const box = (await removeButton.boundingBox())!
    expect(box.height, 'chip remove-button height').toBeLessThanOrEqual(20)
    expect(box.width, 'chip remove-button width').toBeLessThanOrEqual(20)
    expect(await chip.evaluate((el) => getComputedStyle(el).paddingRight), 'chip right inset').toBe('8px')
  })
})
