// Viewport coverage for the admin surface (issue #101).
//
// The admin screens were never in the viewport suite: the role-set spec
// (admin-roles.spec.ts) was the first to look, and had to narrow its checks to
// overflow + readability because everything the admin views are built from —
// the section tabs, the form inputs, the selects, the checkbox, the row action
// buttons — sat under the 44px touch floor at phone widths.
//
// This spec walks every admin section, plus the two forms and a confirm dialog,
// with the *full* check set (overflow, readability, touch targets) on every
// resolution in the matrix. It is the acceptance test for the sizing pass: it
// only goes green once the shared primitives meet the floor.

import type { Page } from '@playwright/test'
import { expectViewportHealthy } from './helpers/viewport'
import { expect, test } from './fixtures'

/** The section tabs, in the order AdminView renders them (German labels). */
const SECTIONS = ['Dienste', 'Kategorien', 'Rollen', 'Ankündigungen', 'Suchanalyse', 'Audit'] as const

async function gotoAdmin(page: Page): Promise<void> {
  await page.goto('/?admin=1')
  await expect(page.getByRole('heading', { level: 1, name: /Administration/i })).toBeVisible()
}

async function openSection(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i }).getByRole('button', { name: label, exact: true }).click()
  await expect(
    page.getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i }).getByRole('button', { name: label, exact: true }),
  ).toHaveAttribute('aria-current', 'page')
}

/**
 * The icon picker is a scrolling grid, and its box height decides what the
 * *resting* state looks like: a height that does not land on a row boundary
 * leaves a strip of half-drawn glyphs along the bottom edge, which is what the
 * visual review caught at phone widths. The viewport gates cannot see it —
 * they check horizontal overflow — so it is asserted here.
 *
 * Note the box's bottom padding does not hold the next row back in a scroll
 * container, so "padding + n rows + gaps" is 4px too tall; the height has to
 * equal the next row's top offset.
 */
async function expectNoHalfCutIconRow(page: Page, label: string): Promise<void> {
  const cut = await page.evaluate(() => {
    const search = document.querySelector('input[type="search"]')
    const box = search?.closest('fieldset')?.querySelector('[class*="overflow-y-auto"]') as HTMLElement | null
    if (!box) return null
    const edge = box.getBoundingClientRect().bottom
    return Array.from(box.querySelectorAll('button'))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.top < edge - 1 && r.bottom > edge + 1).length
  })
  expect(cut, `${label}: the icon picker must not be scrolled to a half-row`).toBe(0)
}

test.describe('the admin surface at every viewport', () => {
  for (const section of SECTIONS) {
    test(`the ${section} section is viewport-healthy`, async ({ page }) => {
      await gotoAdmin(page)
      await openSection(page, section)
      // Wait for the section's own content, not just the tab state, so the
      // check runs against the loaded screen.
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible()

      // The role editor's rows only exist once the selected role has a default
      // service, and the row is where its three action buttons live — add one
      // rather than depending on which seeded role happens to have defaults.
      if (section === 'Rollen') {
        await page.getByLabel('Hinzufügen').selectOption({ index: 1 })
        await expect(page.getByRole('button', { name: /Nach oben/ }).first()).toBeVisible()
      }
      // No explicit check here: this *is* the test's final state, and the
      // fixture in fixtures.ts runs the full check set against it.
    })
  }

  test('the service form, its icon picker and the delete dialog are viewport-healthy', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true
    await gotoAdmin(page)
    await openSection(page, 'Dienste')

    await page.getByRole('button', { name: 'Neuer Dienst' }).click()
    await expect(page.getByRole('heading', { level: 3 })).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'admin – service form' })

    // The icon picker is a grid of icon-only buttons — the densest cluster of
    // touch targets in the app.
    await page.getByLabel('Icon').fill('mail')
    await expect(page.getByRole('button', { name: /mail/i }).first()).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'admin – icon picker' })
    await expectNoHalfCutIconRow(page, 'icon picker, searched')

    // Keyword chips: the chip's remove button is its own small target.
    await page.getByLabel('Suchbegriffe (optional)').fill('fernzugriff, vpn')
    await page.getByLabel('Suchbegriffe (optional)').press('Enter')
    await expect(page.getByRole('button', { name: /fernzugriff/ })).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'admin – keyword chips' })

    await page.getByRole('button', { name: 'Abbrechen' }).click()

    // The *edit* form of a service that has a doc_url: its live preview renders
    // the grid card, whose documentation chip is the one control only reachable
    // at phone widths through this screen (issue #101).
    await page
      .getByRole('listitem')
      .filter({ hasText: 'MyShare' })
      .getByRole('button', { name: 'Bearbeiten' })
      .click()
    await expect(page.getByRole('heading', { level: 3, name: /bearbeiten/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Doku/ })).toBeVisible()
    // The edit form arrives with an empty icon search, i.e. the full curated
    // list — the state that actually overflows the picker's box.
    await expect(page.getByRole('button', { name: 'hard-drive' })).toBeVisible()
    await expectNoHalfCutIconRow(page, 'icon picker, curated list')
    await expectViewportHealthy(page, { isMobile, label: 'admin – service edit form with preview' })
    await page.getByRole('button', { name: 'Abbrechen' }).click()

    // The confirm dialog over the list.
    await page.getByRole('button', { name: 'Löschen' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'admin – delete dialog' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  // The visual review saw the top bar rendered mid-page in a screenshot of this
  // form. That was the known full-page-capture artifact (Chromium stitches a
  // sticky element into every strip it captures), not a layout bug — this pins
  // the real behaviour so the question does not come back: after scrolling a
  // long form, the bar is still at the top of the viewport and still the
  // element the finger lands on there.
  test('the top bar stays pinned while a long form scrolls', async ({ page }) => {
    await gotoAdmin(page)
    await openSection(page, 'Dienste')
    await page.getByRole('button', { name: 'Neuer Dienst' }).click()
    await expect(page.getByRole('heading', { level: 3 })).toBeVisible()

    await page.evaluate(() => window.scrollBy(0, 600))
    await expect
      .poll(async () => page.evaluate(() => Math.round(window.scrollY)), { message: 'the form scrolled' })
      .toBeGreaterThan(100)

    const pinned = await page.evaluate(() => {
      const header = document.querySelector('header')!
      const box = header.getBoundingClientRect()
      return {
        position: getComputedStyle(header).position,
        top: Math.round(box.top),
        hitAtTop: !!document.elementFromPoint(Math.round(window.innerWidth / 2), 4)?.closest('header'),
      }
    })
    expect(pinned.position).toBe('sticky')
    expect(pinned.top, 'the bar sits at the top of the viewport, not mid-page').toBe(0)
    expect(pinned.hitAtTop, 'the bar is what the top of the viewport hits').toBe(true)
  })

  test('the announcement form is viewport-healthy', async ({ page }) => {
    await gotoAdmin(page)
    await openSection(page, 'Ankündigungen')

    await page.getByRole('button', { name: 'Ankündigung anlegen' }).click()
    await expect(page.getByRole('heading', { level: 3 })).toBeVisible()
    // Every control the issue lists lives on this one form: text inputs, two
    // selects, a datetime input, the dismissible checkbox and the buttons.
    await expect(page.getByLabel('Zielgruppe')).toBeVisible()
    // Final state again: the fixture checks it.
  })
})
