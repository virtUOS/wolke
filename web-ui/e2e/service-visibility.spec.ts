// Service visibility v2 (issues #34/#121, docs/specs/service-visibility.md §6),
// at every resolution in the matrix. Two independent halves:
//
//  1. Beta (§2.1): the account-menu switch → warning → the beta service appears
//     inline in its own category, badged Beta, with a Beta filter beside the
//     maintenance one → switch off → gone again. The fixture is the seeded
//     "Zettelkasten Labor" (dev/seed.sql), tagged beta — no configuration.
//  2. Restricted categories (§2.2): the seeded "IT-Infrastruktur" category is
//     restricted to the `it-infra` group, which dev/config.e2e.yaml maps to a
//     claim value the mock IdP does not emit. So the e2e user holds nothing:
//     neither the category nor "Serververwaltung" may appear anywhere — while
//     the admin screens, which read unnarrowed (§5), must still manage both.
//
// The beta switch is a real server write on the one shared test user, so that
// flow runs under a cross-worker lock (helpers/lock.ts) and always leaves the
// pref off — the state every other spec assumes.

import type { Page } from '@playwright/test'
import { withCrossWorkerLock } from './helpers/lock'
import { expectViewportHealthy } from './helpers/viewport'
import { gotoApp } from './helpers/session'
import { expect, test } from './fixtures'

const BETA_SERVICE = /Zettelkasten Labor/
const BETA_CATEGORY = 'KI-Werkzeuge'
const RESTRICTED_SERVICE = /Serververwaltung/
const RESTRICTED_CATEGORY = 'IT-Infrastruktur'

// Six workers may queue behind the lock; each flow takes a few seconds.
test.setTimeout(120_000)

/** Puts the shared user back into the beta-off state, whatever a failed run left. */
async function betaOff(page: Page) {
  const res = await page.request.patch('/api/me/prefs', { data: { show_beta: false } })
  expect(res.status(), 'reset show_beta').toBe(200)
}

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: /Konto-Menü|Account menu/i }).click()
  const menu = page.getByRole('dialog', { name: /Konto|Account/i })
  await expect(menu).toBeVisible()
  return menu
}

test('turning on beta reveals the beta service, badged, with its filter; turning it off hides it again', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await withCrossWorkerLock('visibility-beta', async () => {
    await betaOff(page)
    try {
      await gotoApp(page, '/?tab=dienste')
      const main = page.getByRole('main')

      // Hidden by default: no service, no category pill, no Beta filter.
      await expect(main.getByRole('link', { name: BETA_SERVICE })).toHaveCount(0)
      await expect(page.getByRole('button', { name: BETA_CATEGORY })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Beta$/ })).toHaveCount(0)

      // The switch, off; the account menu with it open is a layout state.
      let menu = await openAccountMenu(page)
      const toggle = menu.getByRole('switch', { name: /Beta-Dienste anzeigen|Show beta services/ })
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await expectViewportHealthy(page, { isMobile, label: 'account menu with beta switch' })

      // Turning it on asks first, with the built-in warning — at every width.
      await toggle.click()
      const dialog = page.getByRole('dialog', { name: /Beta-Dienste anzeigen\?|Show beta services\?/ })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/ohne Vorankündigung verschwinden|disappear at any time/)).toBeVisible()
      await expectViewportHealthy(page, { isMobile, label: 'beta warning dialog' })
      await dialog.getByRole('button', { name: /^Anzeigen$|^Show$/ }).click()
      await expect(dialog).toBeHidden()

      // Revealed: inline in its own category, badged by the tag it already had.
      const tile = main.getByRole('link', { name: BETA_SERVICE }).first()
      await expect(tile).toBeVisible()
      await expect(tile).toHaveAccessibleName(/\(Beta\)/)
      if (!isMobile) {
        // Its own category is a real filter again, and so is the Beta facet.
        await expect(page.getByRole('button', { name: BETA_CATEGORY })).toBeVisible()
        const betaFilter = page.getByRole('button', { name: /^Beta$/ })
        await expect(betaFilter).toBeVisible()
        await betaFilter.click()
        await expect(main.getByRole('link', { name: BETA_SERVICE })).toHaveCount(1)
        await expectViewportHealthy(page, { isMobile, label: 'beta filter active' })
        await page.getByRole('button', { name: /^Alle$|^All$/ }).click()
      }
      await expectViewportHealthy(page, { isMobile, label: 'beta service visible' })

      // Search resolves it too — search is a read surface like any other.
      const search = page.getByRole('searchbox')
      await search.fill('Zettelkasten')
      await expect(main.getByRole('link', { name: BETA_SERVICE }).first()).toBeVisible()
      await search.fill('')

      // Turning it off is immediate: no dialog, and the service is gone.
      menu = await openAccountMenu(page)
      const on = menu.getByRole('switch', { name: /Beta-Dienste anzeigen|Show beta services/ })
      await expect(on).toHaveAttribute('aria-checked', 'true')
      await on.click()
      await expect(page.getByRole('dialog', { name: /anzeigen\?|Show beta.*\?/ })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(main.getByRole('link', { name: BETA_SERVICE })).toHaveCount(0)
      await expect(page.getByRole('button', { name: BETA_CATEGORY })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Beta$/ })).toHaveCount(0)
    } finally {
      await betaOff(page)
    }
  })
})

// A restricted category the user does not hold: absent from the dashboard, and
// absent from the API's every read surface. Nothing to toggle — the group comes
// from the IdP — so no lock is needed.
test('a restricted category is invisible to a non-holder, in the UI and in the API', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true
  await gotoApp(page, '/?tab=dienste')
  const main = page.getByRole('main')

  await expect(main.getByRole('link', { name: RESTRICTED_SERVICE })).toHaveCount(0)
  await expect(page.getByRole('button', { name: RESTRICTED_CATEGORY })).toHaveCount(0)
  await expectViewportHealthy(page, { isMobile, label: 'dashboard without the restricted category' })

  const names = async (url: string) => {
    const res = await page.request.get(url)
    expect(res.status(), url).toBe(200)
    const body = (await res.json()) as { services: { name: string }[]; categories?: { slug: string }[] }
    return { services: body.services.map((s) => s.name), categories: body.categories?.map((c) => c.slug) ?? [] }
  }

  const me = await (await page.request.get('/api/me')).json()
  expect(me.visibility.held, 'the mock IdP grants no group').toEqual([])
  expect(me.show_beta).toBe(false)

  const catalog = await names('/api/catalog')
  expect(catalog.services).not.toContain('Serververwaltung')
  expect(catalog.categories).not.toContain('it-infra')
  // Beta is hidden by the same call, through the other half of the predicate.
  expect(catalog.services).not.toContain('Zettelkasten Labor')
  expect(catalog.categories).not.toContain('ai-tools')

  expect((await names('/api/search?q=Serververwaltung')).services).toEqual([])
  expect((await names('/api/search?q=Zettelkasten')).services).toEqual([])
  expect((await names('/api/catalog/defaults')).services).not.toContain('Serververwaltung')
  expect((await names('/api/favorites')).services).not.toContain('Serververwaltung')
  expect((await names('/api/usage/frequent')).services).not.toContain('Serververwaltung')
})

// The admin-narrowing fix (spec §5): the admin screens read unnarrowed data, so
// an admin who holds no group still sees and manages the restricted category
// and the service in it. The e2e user is an admin holding nothing — exactly the
// case the defect broke.
test('an admin holding no group still manages the restricted category and its service', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true

  // The API the admin screens read is unnarrowed, and reports the group.
  const cats = (await (await page.request.get('/api/admin/categories')).json()) as {
    categories: { slug: string; visibility?: string }[]
  }
  const infra = cats.categories.find((c) => c.slug === 'it-infra')
  expect(infra, 'the admin category list is unnarrowed').toBeTruthy()
  expect(infra?.visibility).toBe('it-infra')
  const svcs = (await (await page.request.get('/api/admin/services')).json()) as { services: { name: string }[] }
  expect(svcs.services.map((s) => s.name)).toContain('Serververwaltung')

  await page.goto('/?admin=1')
  await expect(page.getByRole('heading', { level: 1, name: /Administration/i })).toBeVisible()

  // Categories tab: the restricted category is listed, named with its group.
  await page
    .getByRole('navigation', { name: /Admin-Bereiche|Admin sections/i })
    .getByRole('button', { name: 'Kategorien', exact: true })
    .click()
  const row = page.getByRole('listitem').filter({ hasText: RESTRICTED_CATEGORY })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(RESTRICTED_CATEGORY)
  await expectViewportHealthy(page, { isMobile, label: 'admin category list with a restricted category' })

  // Editing it prefills the visibility selector with the group.
  await row.getByRole('button', { name: /^Bearbeiten$|^Edit$/ }).click()
  const group = page.getByRole('group', { name: /^Sichtbarkeit$|^Visibility$/ })
  await expect(group).toBeVisible()
  await expect(group.getByLabel(RESTRICTED_CATEGORY)).toBeChecked()
  await expectViewportHealthy(page, { isMobile, label: 'category editor with the visibility selector' })
  await page.getByRole('button', { name: /^Abbrechen$|^Cancel$/ }).click()
})
