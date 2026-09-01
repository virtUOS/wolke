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
    await expectViewportHealthy(page, { isMobile, label: 'admin – service edit form with preview' })
    await page.getByRole('button', { name: 'Abbrechen' }).click()

    // The confirm dialog over the list.
    await page.getByRole('button', { name: 'Löschen' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectViewportHealthy(page, { isMobile, label: 'admin – delete dialog' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
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
