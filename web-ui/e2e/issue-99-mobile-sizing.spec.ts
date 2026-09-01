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
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

/** The row height the phone list is designed around: 44px icon chip + 2×14px. */
const MIN_ROW_HEIGHT = 70
/** The touch floor (helpers/rules.ts MIN_TOUCH_TARGET). */
const MIN_TOUCH_TARGET = 44

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

    // The two controls inside a row (documentation link, favourite star). The
    // fixture's touch-target check covers the whole page; this names them, so a
    // regression reads as "the star shrank" rather than a generic violation.
    const row = page.locator('.tile-list-item').first()
    for (const name of [/Dokumentation/i, /Favoriten/i]) {
      const control = row.getByRole('link', { name }).or(row.getByRole('button', { name }))
      if ((await control.count()) === 0) continue
      const box = await control.first().boundingBox()
      expect(box, `${name} box`).not.toBeNull()
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
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
  })
})
